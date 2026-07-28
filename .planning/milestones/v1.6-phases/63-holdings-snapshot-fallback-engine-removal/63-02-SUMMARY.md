---
phase: 63-holdings-snapshot-fallback-engine-removal
plan: 02
subsystem: allocations/scenario-composer
status: complete
completed: 2026-07-03
tags: [ENGINE-01, ENGINE-03, GUARD-02, GUARD-03, series-space, deletion]
requirements: [ENGINE-01, ENGINE-03]
dependency_graph:
  requires: [63-01 (buildAddedOnlySet exported)]
  provides:
    - "ScenarioComposer engine set is series-space only (per-key + added units); NO holdings-snapshot builder, NO symbol-keyed alias collapse"
    - "gate=false book holders init BLANK with the DSRC-02 note; book entry unreachable without a per-key engine (ENGINE-03)"
  affects: [63-03 (compare deletion), 63-04 (adapter/dealias retirement)]
tech-stack:
  patterns:
    - "identity-pair engine set: { strategies: activeAdapterOutput.strategies, state: projectionState } — collapse removed, projectionState covers every unit id"
    - "test repoint via REAL per-key path: winUnits / perKeyBook / catalogStrategy helpers deliver ids/series/spans so oracle bodies stay byte-unchanged"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx
decisions:
  - "Restore the makePayload default to a gate-satisfied book holder (the historical book-mode default) — the 1d generic-book repoint applied once at the harness level; gate=false tests override explicitly"
  - "Per-key unit labels render as `key {id}`; the four name-matching CORR/IMPACT oracles were repointed to that real label (reviewed 1c)"
  - "H-0487 retired here (not deferred to ENGINE-04): its holdings-collapse premise dies with the composer deletion; the Pitfall-3 count-preserved block remains the living avg-ρ pin"
metrics:
  duration: ~1h47m (16:31–18:19 local)
  commits: 6
  tasks_completed: 3
  files_modified: 4
  composer_suite: 162/162
  wave_gate: 7455 passed / 0 failed / 288 skipped
---

# Phase 63 Plan 02: Delete the Composer Holdings Path (ENGINE-01) + ENGINE-03 Summary

Removed the holdings-snapshot engine path from `ScenarioComposer` — the largest
holdings-engine consumer — so its engine set is now **series-space only**: book+gate
blends per-key units with added strategies (`mergeAddedIntoPerKeySet`); blank /
gate=false is added-only (`buildAddedOnlySet`). Landed ENGINE-03 (gate=false blank
init + repointed DSRC-02 note) atomically with the deletion so no intermediate
state shows a gate=false book mode with no engine behind it.

## Tasks

**Task 0 — ENGINE-03 (RED `3d280f09` → GREEN `f56d074b`):** cherry-picked the
Wave-1 RED tests (5 assertions), applied the preserved 86-line GREEN patch
(`canEnterBook = hasLiveBook && gate`; init flip; `handleEntryModeSelect` refusal;
`showDataSourcesFallback` repointed to `hasLiveBook`; segment/arrow/tabIndex gated).
The book segment is **hidden** when `!canEnterBook` — consistent with the existing
hide-not-disable convention for that control (Rule 11); DESIGN.md has no
disabled-vs-hidden rule and the RED tests encode the hidden choice.

**Task 1 — composer deletion (`51006ebc`):** deleted the scenario-dealias import
group, the `buildStrategyForBuilderSet` import (→ `buildAddedOnlySet`), the
`adapterOutput` holdings memo (+ dead `disabledHoldingRefs` + unused
`holdingReturnsByScopeRef` destructure), the `symbolByHoldingId` memo. Replaced the
`activeAdapterOutput` else-branch with `buildAddedOnlySet`, the `deAliased` collapse
memo with the identity pair `engineSet` (renamed, all ~30 downstream consumers
repointed), simplified the engineState window injection, and swapped the optimizer
apply-back to a direct `scenario.applyWeightOverrides(weights)` (#528 drift
unchanged). Rewrote all stale B4-pin / collapse / de-alias comments.

**Task 2 — composer test rebase + H-0487 retirement (`e8899124`):** rebased ~89
broken tests to the REAL series-space path via shared helpers, each disposition an
individually reviewed act (no mechanical sweep):
- **1a dead wiring:** removed the builder import, the vi.mock spy, and every dead
  `mockReturnValue` reset (adapter is REAL via importOriginal now).
- **1b engine-injection repoints:** WINDOW-01..06 / POLISH-01/02 / PERSIST-01 / CORR
  / blend / H-0133 / R4 / M-0096 delivered through `winUnits` / `perKeyBook`
  (book+gate) or `catalogStrategy` + `addStrategy` (added), ids/series/spans
  preserved so member_count/window/correlation/PCR oracle bodies stay byte-unchanged.
- **1c subject-vanishes:** T_C_ADAPT1/2/3 + the T_C_M4 single-call pin retired; the
  T_C_LAZY/WR-05 returns-lookup oracle repointed to observe the REAL engine set's
  per-id series (via an enhanced `computeScenario` capture).
- **1d generic-book:** `makePayload` default is now a gate-satisfied book holder.
- **H-0487 retired** with rationale (grep-satisfied in the commit message).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] openSavedScenario drift base used the mode-gated holdingsSummary**
- **Found during:** Task 0 (the reopen-edge ENGINE-03 test failed).
- **Issue:** under forced-blank (gate=false), the composer's `holdingsSummary` memo
  switches to `[]`, so `openSavedScenario`'s `defaultDraft` fingerprint was empty →
  EVERY reopen looked drifted → the MEMBER-04 ineligible disclosure was falsely
  suppressed. Entry mode is a presentation toggle, not a change to the live book;
  the drift derivation's own docstring says "defaultDraft carries the LIVE holdings
  fingerprint".
- **Fix:** drift base uses `rawHoldingsSummary` (the live book) + dep updated. No-op
  in book mode (the two are identical).
- **Commit:** `f56d074b`

**2. [Rule 3 - Blocking] Dependent adapter mocks missing the new imports**
- **Found during:** wave gate (full `npm test`).
- **Issue:** Task 1's composer now imports `buildAddedOnlySet` /
  `mergeAddedIntoPerKeySet`; two dependent suites mocked scenario-adapter without
  them, so `activeAdapterOutput` threw on render.
- **Fix:** `AllocationsTabs.scenario-state-preservation` got empty-projection
  stand-ins (engine-agnostic suite); `ScenarioComposer.save.test` repointed its
  windowed-save (CR-01) book to the REAL per-key path (importOriginal + per-key
  fixtures) and dropped the dead builder import/stub.
- **Commit:** `8562be10`

### Reviewed Repoints (documented, not strict byte-unchanged)

- **POLISH-01 startDates oracle value:** the test pinned a *custom* per-strategy
  startDate injected through the deleted mock's `state.startDates`. The per-key
  path sets startDate = series start, so the asserted value changed
  (`{A: LONG_DATES[5]}` → `{A/B: LONG_DATES[0]}`) with an inline rationale. The
  test's INTENT (a coverage-window change never mutates startDates) is preserved
  and remains falsifiable.
- **CORR/IMPACT name assertions:** per-key units render as `key {id}`; CORR-01 /
  CORR-05 / CORR-06 / IMPACT-01 exact-name oracles were repointed to that real
  label (the honest per-key rendering).
- **H-0487 not "its own commit":** the retirement is folded into the Task-2 commit
  (all changes live in one file, interactive staging unavailable). The commit
  message carries the full H-0487 rationale, satisfying the grep gate.

### Follow-up cleanup (`619cd5f9`)

Dropped the last dead scenario-dealias wiring from the composer test (the Phase-37
independent oracle ran the real collapse with an empty symbol map = identity →
replaced with the identity pair), decoupling the test from the Wave-4-doomed
module. The sole remaining `symbolByHoldingId` reference is inside the Pitfall-3
verbatim survivor's it() body (byte-unchanged, GUARD-02).

## Verification

- **Full composer suite:** 162/162 green.
- **Wave gate (`npx vitest run`):** 624 files / 7455 tests passed, 0 failed, 288 skipped.
- **Grep gates (composer):** all five banned identifiers absent; `buildAddedOnlySet` present.
- **Grep gate (composer test):** `buildStrategyForBuilderSet` absent.
- **GUARD-02:** P61-BUG-1 (:7061) + Pitfall-3 it() bodies byte-unchanged — the sole
  hunk in those describes is the removed dead beforeEach mock plumbing.
- **GUARD-03:** `git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts` empty.
- **tsc + eslint:** clean (0 errors, 0 warnings) on all four touched files.
- **scenario-dealias.test.ts (Wave-4 owned):** untouched, 23/23 green.

## Requirements

ENGINE-01 (composer engine set = per-key + added only, blank = buildAddedOnlySet)
and ENGINE-03 (gate=false → blank init + rendered note + unreachable book entry)
satisfied.

## Commits

- `3d280f09` test(63-02): RED ENGINE-03 gate=false blank init + note repoint + reopen edge
- `f56d074b` feat(63-02): ENGINE-03 gate=false blank-mode init + DSRC-02 note repoint (+ Rule 1 drift fix)
- `51006ebc` feat(63-02): delete the composer holdings path; wire the identity pair (ENGINE-01)
- `e8899124` test(63-02): rebase composer test plumbing to series-space; retire H-0487 (GUARD-02)
- `8562be10` test(63-02): [Rule 3] repoint dependent adapter mocks to series-space engine set
- `619cd5f9` test(63-02): drop the last dead scenario-dealias wiring from the composer test

## Self-Check: PASSED

- Composer banned-identifier grep gates: VERIFIED absent (composer=0 for all 5)
- buildAddedOnlySet wired in composer: VERIFIED (3 refs)
- Composer test `buildStrategyForBuilderSet` grep: VERIFIED absent
- GUARD-03 zero-diff: VERIFIED empty
- Wave gate 7455/0: VERIFIED
- All commits reachable on branch: VERIFIED
</content>
