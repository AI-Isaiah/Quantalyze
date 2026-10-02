---
phase: 40-mount-the-real-factsheet-body
plan: 01
subsystem: factsheet-v2 / scenario-parity
tags: [scenarioMode, additive-prop, byte-identity, interface-first, BODY-02]
requires:
  - FactsheetBody (exported mountable subtree, FactsheetView.tsx)
  - ControlBar / MetricsColumn (FactsheetView.tsx / MetricsColumn.tsx)
provides:
  - "scenarioMode?: boolean on FactsheetBodyOptions (default false)"
  - "ControlBar Share-link + Compare suppression when scenarioMode={true}"
  - "MetricsColumn scenarioMode seam (inert, Phase-42 peer carve-out)"
  - "BODY-02 prop-equivalence + suppression test"
affects:
  - "Plan 40-02 (the composer mount consumes scenarioMode={true})"
  - "Phase 42 (MetricsColumn scenarioPeer carve-out via this seam)"
tech-stack:
  added: []
  patterns:
    - "interface-first prop threading (define the contract before the consumer)"
    - "void scenarioMode; lint-safe inert seam (RESEARCH Pitfall 4)"
    - "byte-identity proof via innerHTML equality (default ≡ explicit false)"
key-files:
  created:
    - src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
decisions:
  - "scenarioMode is additive, default false — every existing call site byte-identical"
  - "Suppression treatment is ABSENCE (no aria-hidden/disabled) per UI-SPEC §Accessibility"
  - "MetricsColumn gates nothing in Phase 40; void scenarioMode; keeps the seam lint-clean"
metrics:
  duration: ~10m
  completed: 2026-06-26
  tasks: 2
  files: 3
---

# Phase 40 Plan 01: Thread the additive scenarioMode prop through FactsheetBody Summary

Added the additive `scenarioMode?: boolean` prop (default `false`) to
`FactsheetBodyOptions`, threaded it into exactly two children — `ControlBar`
(suppress the Copy-share-link + Compare-strategies actions when `true`) and
`MetricsColumn` (inert Phase-42 peer-carve-out seam) — and pinned the
byte-identity contract with a net-new BODY-02 test. This is the interface-first
contract that Plan 40-02's mount consumes; default `false` keeps `page.tsx`, the
Discovery detail page, and the Overview `EquityChartWidget` byte-identical.

## What Was Built

### Task 1 — scenarioMode threading (commit `3db016ea`)
- `FactsheetBodyOptions` gains `scenarioMode?: boolean` with a doc comment naming
  it the composer-mount flag (default false → byte-identical call sites; Phase-42
  peer seam).
- `FactsheetBody` destructures `scenarioMode = false` and threads it to
  `<ControlBar scenarioMode={scenarioMode} />` and
  `<MetricsColumn scenarioMode={scenarioMode} />`.
- `ControlBar` gains a `scenarioMode?: boolean` prop (default false). The
  `<ShareLinkButton>` render is wrapped in `!scenarioMode &&`; the
  Compare-strategies `<a>` guard becomes `!scenarioMode && !shareMode &&`.
  Display / Reset view / ComparatorPicker stay unconditional. Suppression is by
  ABSENCE (no aria-hidden, no disabled) per UI-SPEC §Accessibility.
- `MetricsColumn` gains `scenarioMode?: boolean` (default false) plus a
  `void scenarioMode;` no-op with a comment naming Phase 42 as the consumer —
  the lint-safe inert seam (RESEARCH Pitfall 4). No conditional render keyed off
  it this phase.

### Task 2 — BODY-02 test (commit `ea40afe3`)
- New `FactsheetBody.scenario-mode.test.tsx` mounts the real `FactsheetBody`
  under a real `FactsheetProvider persist={false}` fed a populated payload
  (`buildScenarioFactsheetPayload` with a ~300-point healthy returns series).
- Test 1 (prop equivalence): default props ≡ `scenarioMode={false}` →
  identical `container.innerHTML`.
- Test 2 (suppression): `scenarioMode={true}` → neither "Copy share link" nor
  "Compare strategies"; `scenarioMode={false}` → both present. Both new
  ControlBar branches exercised so branch coverage doesn't drop (RESEARCH
  Pitfall 6).
- Test 3 (controls retained): `scenarioMode={true}` keeps "Reset view" + the
  "Display" menu.
- Mandatory localStorage + sentry stub block copied verbatim from
  `scenario-shared-window.test.tsx` (the provider's persistence primitive touches
  both on mount even at `persist={false}`).

## Verification

- `npx tsc --noEmit` — clean (full project, exit 0).
- `npx eslint` on all three touched files — 0 errors. `void scenarioMode;`
  produced no `no-unused-vars` failure. (The 4 pre-existing FactsheetView
  warnings are unrelated and untouched.)
- `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx"
  --no-file-parallelism` — 3/3 green.
- Regression: `npx vitest run src/app/factsheet/[id]/v2/ +
  src/app/(dashboard)/allocations/widgets/performance/ --no-file-parallelism` —
  18 files / 180 tests green (includes the byte-identity call-site tests and the
  ScenarioComposer static-guard family).
- `git diff --name-only HEAD~2 HEAD` lists ONLY FactsheetView.tsx,
  MetricsColumn.tsx, and the new test — no page.tsx / Discovery /
  AllocationDashboardV2 changes. Byte-identity boundary preserved.

## Deviations from Plan

None — plan executed exactly as written. The TDD-flagged tasks were executed in
the plan's stated order (Task 1 = source change, Task 2 = the BODY-02 test that
pins it); the test failed-then-passed semantics are satisfied by the test
asserting the new branches, which would fail against the pre-Task-1 `ControlBar`
(no scenarioMode prop → Share/Compare always render).

## Known Stubs

The `MetricsColumn` `scenarioMode` seam is intentionally inert in Phase 40 — it
gates no visible render and is documented (`void scenarioMode;` + comment) as the
Phase-42 (PEER-01) peer-carve-out consumer. This is a planned, contract-locked
seam (40-CONTEXT.md §scenarioMode additive prop), not an incomplete feature.

## Threat Flags

None. This plan adds no fetch/input/auth/DB/secret/persistence-write surface; the
T-40-01 mitigation (scenarioMode suppresses the shareable `/compare?ids=` URL +
copyable link for a hypothetical blend) is asserted by the BODY-02 suppression
test.

## Self-Check: PASSED

- FOUND: src/app/factsheet/[id]/v2/FactsheetView.tsx (modified)
- FOUND: src/app/factsheet/[id]/v2/MetricsColumn.tsx (modified)
- FOUND: src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx (created)
- FOUND commit: 3db016ea (Task 1 — feat)
- FOUND commit: ea40afe3 (Task 2 — test)
