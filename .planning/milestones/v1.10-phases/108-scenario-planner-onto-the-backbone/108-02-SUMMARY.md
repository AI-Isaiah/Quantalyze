---
phase: 108-scenario-planner-onto-the-backbone
plan: 02
subsystem: allocations-scenario-planner
tags: [scenario-planner, backbone-unification, delete-gate, blend-panels, vitest, source-scan-gate]

# Dependency graph
requires:
  - phase: 108-01
    provides: "src/lib/scenario-blend-adapter.ts::deriveBlendPanels — backbone-routed blend-panel derivation with the exact legacy public shape"
provides:
  - "ScenarioComposer.tsx blend panels derive via the backbone adapter (SC-1) — the bespoke second-Sharpe TS compute is gone"
  - "src/lib/scenario-blend-panels.ts (211 LOC) + its 251-LOC test DELETED (SC-2)"
  - "src/lib/scenario-backbone-gates.test.ts — permanent, liveness-proven, comment-stripped SC-2 delete-gate + SC-3 keep-gate tripwire"
affects: [scenario-planner-blend-surface, phase-108-close]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delete-then-gate discipline (107 precedent): rewire the single consumer onto the backbone adapter, git rm the bespoke module + test, land a permanent comment-stripped source-scan gate with concatenated forbidden tokens + a live retired-line fixture so a regex typo can't pass vacuously"
    - "Comment-stripped whole-src walk that ignores surviving doc-comment references (PAYLOAD-03 pin, repointed precedent docstrings) — only a live CODE token trips the gate"

key-files:
  created:
    - src/lib/scenario-backbone-gates.test.ts
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/lib/diversification.ts
    - src/__tests__/phase-30-frozen-spine-guards.test.ts
  deleted:
    - src/lib/scenario-blend-panels.ts
    - src/lib/scenario-blend-panels.test.ts

key-decisions:
  - "Composer diff kept to exactly 3 lines (import + memo callee + 1 comment word); the render tree :4276-4382 and the variable name `blendPanels` are byte-untouched → SC-4 pixel-parity contract holds by construction"
  - "Gate models the 107 leverage-backbone-gates.test.ts template wholesale: node env, recursive src/ walk, stripComments, self-exclusion; forbidden tokens `scenario-blend-`+`panels` / `buildBlend`+`Panels` and the retired-import fixture are string-concatenated so the gate never self-matches"
  - "SC-3 keep-gate asserts portfolio-stats.ts / health-score.ts / scenario.ts / metrics-parity.test.ts still EXIST on disk — the out-of-scope keep-list cannot be silently deleted by a later cleanup pass"
  - "Two dangling doc-comments repointed for correctness (diversification.ts:30 → scenario-blend-adapter.ts; phase-30 docstring reworded to drop the deleted filename); scenario-factsheet-payload.test.ts:212 PAYLOAD-03 note left VERBATIM (out of scope, historical convention pin, ignored by the comment-stripped scan)"

requirements-completed: [SCEN-BB]

# Metrics
duration: ~12min
completed: 2026-07-15
---

# Phase 108 Plan 02: Rewire ScenarioComposer onto the backbone + delete the second-Sharpe module Summary

**ScenarioComposer's blend panels now derive from the Plan-01 backbone adapter (`deriveBlendPanels`); the bespoke 211-LOC `scenario-blend-panels.ts` "second Sharpe" compute + its 251-LOC test are deleted behind a permanent, liveness-proven, comment-stripped SC-2 delete-gate — the Phase-107 delete-then-gate discipline applied to the scenario surface, with SC-4 pixel parity held by a 3-line render-tree-untouched consumer diff.**

## Performance
- **Duration:** ~12 min
- **Completed:** 2026-07-15
- **Tasks:** 3 completed (2 code commits + 1 verification-only sweep)
- **Files:** 1 created, 4 modified, 2 deleted

## Accomplishments
- **Task 1 (`89e982c0`):** Swapped `ScenarioComposer.tsx:102` import to `deriveBlendPanels` from `@/lib/scenario-blend-adapter`, changed the `:2821` memo callee (same args/deps/shape, variable stays `blendPanels`), and updated the `:2809` comment word. The diff is exactly 3 lines with **nothing in the `:4276-4382` render region** (SC-4 pixel parity). Re-anchored the composer static-honesty-guard positive control (`/buildBlendPanels/`→`/deriveBlendPanels/`) + the two WR-02 comment mentions. `git rm` of both legacy files. Repointed the 2 now-dangling doc-comments (`diversification.ts:30`, `phase-30-frozen-spine-guards.test.ts:6`); left `scenario-factsheet-payload.test.ts:212` PAYLOAD-03 note verbatim. Comment-stripped delete-check → 0 non-comment hits.
- **Task 2 (`140e8b6e`):** Created `src/lib/scenario-backbone-gates.test.ts` (4 tests) modeled on the 107 `leverage-backbone-gates.test.ts` template — SC-2 whole-src comment-stripped scan (concatenated forbidden tokens + concatenated retired-import fixture so the gate never self-matches), SC-2 on-disk absence of both legacy files, SC-3 keep-gate presence of the four out-of-scope siblings, and a liveness sub-test proving the matcher fires on the retired fixture. Neuter-confirmed once: planting a live `buildBlendPanels` reference in `scenario-blend-adapter.ts` turned SC-2 RED; reverted clean.
- **Task 3 (verification-only):** Full phase gate green end-to-end.

## Verification
- Touched-suite (Task 1): `ScenarioComposer.test.tsx` + `scenario-blend-adapter.test.ts` + `phase-30-frozen-spine-guards.test.ts` → **185 passed**; tsc clean.
- Gate (Task 2): `scenario-backbone-gates.test.ts` → **4 passed**; neuter-confirm RED→revert-clean.
- **Full suite `npm test` → 8158 passed / 0 failed** (670 files, 287 skipped) — up from the ~8142 post-107 baseline (−251-LOC legacy test, +adapter suite +gate).
- **`npm run test:coverage` → exit 0**, thresholds held: lines 86.68 / stmts 84.57 / funcs 81.55 / branches 78.03 (gates 82/80/74/72) — headroom survived the 211-LOC covered-module deletion.
- `npm run typecheck` → exit 0 (with the new gate file present — proves no other file imported the deleted module).
- `npm run lint` → 0 errors (1 pre-existing `react-hooks/exhaustive-deps` warning in `EquityChart.tsx`, unrelated to this phase — out of scope, logged below).
- Frozen-surface `git log origin/main..HEAD --grep=108 -- <keep-list + PAYLOAD-03 files>` → **EMPTY**; `git diff origin/main..HEAD -- scenario-factsheet-payload.test.ts` → empty (PAYLOAD-03 byte-untouched); `metrics-parity.test.ts` → 19 green.

## VALIDATION.md SC-row → green-check mapping
- **SC-1** (blend panels derive via backbone): composer static guard re-anchored to the live `deriveBlendPanels` token + `@/lib/scenario-blend-adapter` import; 185-test touched suite green.
- **SC-2** (module deleted + permanent gate): `scenario-backbone-gates.test.ts` green + neuter-confirmed; both legacy files absent; 0 non-comment src references.
- **SC-3** (keep-list untouched, metrics-parity green): keep-gate + frozen-surface git-log empty + metrics-parity 19 green + byte-untouched.
- **SC-4 / SC-4-UI** (no user-visible regression): 3-line render-tree-untouched composer diff; WR-02 + the window-toggle length pins + both degenerate empty-states green through the rewire.

## Deviations from Plan
None — plan executed exactly as written. The premise-correction the plan itself flagged (three COMMENT references survive the composer rewire, requiring the comment-stripped delete-check rather than a bare grep) was handled as specified.

## Out-of-scope discovery (logged, NOT fixed)
- Pre-existing lint warning: `EquityChart.tsx:1119` `react-hooks/exhaustive-deps` missing dependency `period`. Not introduced by this phase (0 edits to that file); a warning, not an error; does not block the gate. Left untouched per scope boundary.

## Known Stubs
None — this is a delete/rewire refactor; no placeholder data paths introduced.

## Threat Flags
None. T-108-01 (non-finite values rendering) stays mitigated — the adapter's verbatim usableN collapse + WR-02 green through the rewire. T-108-03 (reintroduction of the retired path) is now mitigated by the permanent, liveness-proven, comment-stripped delete-gate (Task 2). No new trust boundary: consumer rewire + file deletion inside the client bundle, no persistence/network/auth/input surface.

## Task Commits
1. **Task 1** — `89e982c0` (refactor): rewire onto adapter, delete legacy module+test, repoint doc-comments, re-anchor positive control
2. **Task 2** — `140e8b6e` (test): permanent SC-2/SC-3 backbone delete-gate

## Self-Check: PASSED
- FOUND: src/lib/scenario-backbone-gates.test.ts
- ABSENT (as intended): src/lib/scenario-blend-panels.ts + src/lib/scenario-blend-panels.test.ts
- FOUND commit 89e982c0 (refactor)
- FOUND commit 140e8b6e (test)
