---
phase: 59-saved-shared-compared-windows
plan: 03
subsystem: scenario-compare
tags: [scenario-compare, coverage-window, computeScenario, dealias, PERSIST-03, blend-header]

# Dependency graph
requires:
  - phase: 59-01
    provides: "ScenarioDraft.window?: CoverageWindow (through the codec) — the per-draft window field this plan threads"
provides:
  - "computeMetricsForDraft injects each draft's persisted window POST-collapse (deAliased.state) — heterogeneous windows are honest"
  - "live-book / windowless-v2 drafts stay on the engine UNION path (Phase-55 own-book union lock) — byte-identical to before"
  - "per-column effective {start}–{end} label in the compare <tfoot> Window row (engine-emitted bounds, never re-derived)"
affects:
  - "Phase 60 (VERIFY-01) golden/e2e re-bake — the compare surface now renders per-column windows"
  - "Phase 61 (VERIFY-02) authed prod canary — compare tab shows heterogeneous windows"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "POST-collapse window injection onto deAliased.state (Pitfall 4 — dealias reconstructs state + drops a pre-collapse window)"
    - "AUGMENT a per-column caption (don't replace/duplicate — Pitfall 6): append the effective window to the existing methodologyLine stamp"
    - "engine-emitted effective_start/effective_end as the SOLE window-label source (never re-derive membership in the view layer)"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-compare.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-compare.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioCompareTable.test.tsx"

key-decisions:
  - "Injected the window on deAliased.state (POST-collapse), NEVER on the pre-collapse projectionState — pinned by the windowed-vs-union member_count assertion (T-59-08)"
  - "Left buildLiveBookDraft's hardcoded schema_version: 2 unchanged — the cosmetic bump is harmless but adds an import for no behavioral gain; surgical-change discipline (CLAUDE.md Rule 3). The load-bearing behavior (window omitted → union path) is unchanged"
  - "Augmented the verdict.ok branch ONLY; suppressed the date range on undecodable, below-floor, AND null-effective-bounds columns"

patterns-established:
  - "Window-as-compute-input threaded through computeMetricsForDraft, never a factsheet view-clamp"
  - "Split-text-node RTL assertions use { exact: false } once a caption node gains sibling children"

requirements-completed: [PERSIST-03]

# Metrics
duration: ~12 min
completed: 2026-07-02
---

# Phase 59 Plan 03: Compare Across Windows Summary

**Compare (PERSIST-03) now computes each scenario column at its OWN persisted `draft.window` — injected POST-collapse onto `deAliased.state` so heterogeneous windows are honest — while the live-book column stays windowless (Phase-55 union lock), and the compare `<tfoot>` Window row is augmented with a per-column effective `{start}–{end}` label read straight from the engine's `effective_start`/`effective_end`.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-02T10:13:00Z
- **Completed:** 2026-07-02T10:19:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- **Per-persisted-window compare compute (Task 1):** `computeMetricsForDraft` now injects `draft.window` POST-collapse (`const engineState = draft.window ? { ...deAliased.state, window: draft.window } : deAliased.state`), mirroring the composer's `engineState` idiom. Two drafts with different windows compute independently; a member that doesn't cover a column's window is dropped (`member_count` reflects window membership, not the full selected set).
- **Own-book union lock preserved:** `buildLiveBookDraft()` omits `window`, so the live column's `draft.window` is falsy → union path, byte-identical to before. Pinned by an explicit live-book-vs-windowless-baseline byte-identity assertion (effective bounds + n + twr all match).
- **Per-column effective-window label (Task 2):** the `<tfoot>` Window row's `verdict.ok` branch now appends ` · {effective_start}–{effective_end}` (in `font-mono tabular-nums` with an en-dash, BlendHeader treatment) to the existing `methodologyLine(n)` day-count stamp. The label reads engine-emitted bounds only (never re-derived), stays the quiet `text-text-muted` honesty caption (never accent/warning/winner), and is suppressed on undecodable (older-format), below-sample-floor, and null-effective-bounds columns.

## Task Commits

Each task was committed atomically:

1. **Task 1: inject each draft's window POST-collapse; keep live-book windowless** - `155aa666` (feat)
2. **Task 2: augment the compare `<tfoot>` Window row with a per-column `{start}–{end}` label** - `44c97601` (feat)

**Plan metadata:** committed separately with SUMMARY.md + STATE.md + ROADMAP.md.

## Files Created/Modified

- `src/app/(dashboard)/allocations/lib/scenario-compare.ts` - Injects `draft.window` onto `deAliased.state` POST-collapse; updated the "Heterogeneous windows" honesty-invariant docblock to reflect the wired PERSIST-03 path.
- `src/app/(dashboard)/allocations/lib/scenario-compare.test.ts` - +5 PERSIST-03 pins: windowed effective bounds distinct from union; window member-drop (`member_count`/`member_ids`); two heterogeneous windows independent; live-book windowless byte-identity; windowless-v2 unchanged.
- `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx` - Augmented the `verdict.ok` Window-row stamp with the effective `{start}–{end}` range; removed the now-stale "PERSIST-03 not this component" comment.
- `src/app/(dashboard)/allocations/components/ScenarioCompareTable.test.tsx` - +4 PERSIST-03 pins (append range, heterogeneous distinct ranges, undecodable + below-floor suppression, null-bounds omission) and re-based 2 pre-existing `methodologyLine` assertions to `{ exact: false }` (the stamp node is now split across day-count + date-range children).

## Decisions Made

- **POST-collapse injection (Pitfall 4):** the window is spread onto `deAliased.state`, never the pre-collapse `projectionState` — `collapseAliasedHoldingStrategies` reconstructs state and would silently drop a window set earlier. Verified: `projectionState` (:142-146) has no `window` key; `grep "deAliased.state, window"` matches.
- **`buildLiveBookDraft` schema_version left at 2:** the plan permitted an optional cosmetic bump to `SCENARIO_SCHEMA_VERSION`. Left unchanged — it's never decoded/persisted (research A3), the bump adds an import for zero behavioral gain, and surgical-change discipline (CLAUDE.md Rule 3) favors the smaller diff. The load-bearing property (no `window` field → union path) is intact and asserted.
- **Inline label (not a `CompareWindowLabel` extraction):** the plan allowed either. Inline in the `<tfoot>` branch keeps the label colocated with the day-count stamp it augments and avoids a single-use component (CLAUDE.md Rule 2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Re-based 2 pre-existing `methodologyLine` RTL assertions broken by the label augmentation**
- **Found during:** Task 2 (compare-table test run)
- **Issue:** Two shipped tests (`stamps each column's OWN methodologyLine(n)` at :144-146, and the healthy-column arm of `gates a whole below-floor column` at :216) used exact-node `getByText(methodologyLine(n))`. Augmenting the `verdict.ok` stamp with the date range split that `<span>` into multiple text-node children (the `methodologyLine` string, the ` · ` separator, and two date spans), so RTL's default exact single-node match no longer found the string. This is direct, in-scope fallout of the augmentation.
- **Fix:** switched those assertions to `getByText(methodologyLine(n), { exact: false })` — a substring match that finds the day-count text within the now-augmented node. Test intent (each column shows its own day-count caption) is preserved.
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioCompareTable.test.tsx`
- **Verification:** `npx vitest run ScenarioCompareTable.test.tsx` → 17 passed (12 pre-existing re-verified + 5 new PERSIST-03 pins).
- **Committed in:** `44c97601` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a test-assertion re-base directly caused by the in-scope augmentation).
**Impact on plan:** Necessary to keep the shipped stamp assertions green after the augmentation. No scope creep — no production behavior changed by the fix; the augmentation is additive to the caption.

## Threat Model Coverage

- **T-59-08 (Tampering — silent union fallback / window dropped, mitigate):** the window is injected POST-collapse on `deAliased.state`, never pre-collapse. Pinned by the Task-1 windowed-vs-union assertions (`member_count` drops to 1 when a member doesn't cover an early window; windowed effective bounds differ from the union).
- **T-59-09 (Tampering — own-book union lock broken, mitigate):** `buildLiveBookDraft()` omits `window` → the live column runs the union path. Pinned by the Task-1 live-book-byte-identity assertion (effective bounds + n + twr equal a windowless baseline; the live column carries no window).
- **T-59-10 (Information Disclosure — mislabeled window, accept):** the label reads engine-emitted `effective_start`/`effective_end` (never re-derives) and is suppressed on degenerate/older-format columns — a wrong label would be a display bug, not a data leak. Low severity as designed.
- **T-59-SC (package legitimacy):** vacuously satisfied — zero packages installed (first-party TypeScript only).

## Issues Encountered

None beyond the in-scope test-assertion re-base documented above.

## Known Stubs

None. Both tasks are fully wired to the engine and rendered; no placeholder data, no TODO/FIXME introduced.

## Verification

- `npx vitest run scenario-compare.test.ts` → 11 passed (6 original + 5 PERSIST-03).
- `npx vitest run ScenarioCompareTable.test.tsx` → 17 passed (12 original + 5 PERSIST-03).
- `npx vitest run` (all four compare files together: lib + table + all-columns + panel) → 36 passed, 0 failed (no regression).
- `npx tsc --noEmit` → clean (exit 0) after both tasks.
- **Wave gate:** `npm run test:coverage` → **7363 passed / 0 failed** (288 skipped); coverage above every blocking ratchet — Lines 85.5 (≥82), Statements 83.39 (≥80), Functions 79.83 (≥74), Branches 76.11 (≥72). The Phase-55 frozen-spine + BLEND-07 + PARITY-01 guards are within that green suite.
- **Frozen files untouched:** `git diff 221a6daa..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts` → empty. This plan's two commits touch exactly the 4 planned files, disjoint from Plan 02.
- `e2e/composer-axe.spec.ts`: the new label is static caption text inside the already-labeled `<tfoot>` "Window" row — no new interactive element or landmark, so no new a11y violation (not run here; asserted structurally).

## Next Phase Readiness

- **Phase 59 is now COMPLETE (3/3 plans):** PERSIST-01 (storage-model + versioning, Plan 01), PERSIST-01 reopen + PERSIST-02 share (Plan 02), and PERSIST-03 compare (this plan). The coverage window is durable across all three ways a scenario leaves the composer — saved, shared, compared.
- Ready for `/gsd:verify-work 59` (verify PERSIST-01…03 against the reopen/share/compare surfaces), then Phase 60 (VERIFY-01 golden & e2e re-bake) — the bake is its own phase AFTER compute+parity are green, never in the same commit that changes the math.

## Self-Check

- Created files: `.planning/phases/59-saved-shared-compared-windows/59-03-SUMMARY.md` (this file).
- Modified files exist: `scenario-compare.ts` FOUND, `scenario-compare.test.ts` FOUND, `ScenarioCompareTable.tsx` FOUND, `ScenarioCompareTable.test.tsx` FOUND.
- Commits exist: `155aa666` FOUND, `44c97601` FOUND.

---
*Phase: 59-saved-shared-compared-windows*
*Completed: 2026-07-02*
