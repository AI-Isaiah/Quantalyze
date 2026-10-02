---
phase: 111-constit-unified-constituent-presentation-parity-pre-check-re
plan: 05
subsystem: allocations
tags: [scenario-composer, scenario-footer, commit-gate, red-team-fix, phase-close, honesty, engine-freeze]

# Dependency graph
requires:
  - phase: 111-01
    provides: "Unified constituent list where per-key data sources render as toggleable constituent rows (the exclusion gesture that produced the dirty-but-uncommittable draft)"
provides:
  - "Honest Commit gate: the scenario footer's Commit button is enabled iff handleCommit would emit a non-empty diff set (>=1 committable voluntary_add), never on the raw dirty count"
  - "ScenarioFooter.committableCount prop (optional; defaults to diffCount) separating the DISPLAY dirty count from the COMMIT enabled-state"
affects: [scenario-composer, scenario-footer, CF-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Separate the DISPLAY dirty count (diffCount — exclusions count, CF-05) from the COMMIT enabled-state (committableCount — only voluntary_add): a dirty draft can be uncommittable"
    - "Button enabled-state must equal 'clicking produces an effect' — never advertise a change the action path dead-ends on (F-01)"
    - "F-01 empty-diff guard retained as unreachable-by-design backstop; the primary defense is the disabled button"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioFooter.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "Gate condition: Commit `disabled = committableCount === 0 || commitBlocked`, where `committableCount = scenario.draft.addedStrategies.length`. That is EXACTLY the set handleCommit turns into voluntary_add diffs — the only committable decision under the read-only-tokens model (live holdings are fixed context; a per-key exclusion produces no diff). So committableCount>0 iff handleCommit yields a non-empty diff set, matching the F-01 guard's own condition."
  - "diffCount stays the DISPLAY count: exclusions still count toward the dirty chip / save / mode-switch-park (CF-05 supersession preserved). committableCount is a new optional footer prop defaulting to diffCount so display-only footers and the 9 legacy footer tests are unaffected."
  - "F-01 setCommitError guard kept in handleCommit as defense-in-depth, now unreachable-by-design via the disabled button (task requirement: do not weaken the backstop)."
  - "Two pre-existing tests encoded the pre-fix conflation and were updated to the honest behavior — their REAL oracle was the dirty chip, not the Commit-enabled proxy: (1) F-01 test now asserts Commit DISABLED for a stale-toggle-only draft + '1 change' chip + no dead-end reachable; (2) CR-01 saved-book round-trip test now distinguishes applied-book vs blank-default via the '3 changes' chip (Commit is correctly disabled in both since a book-only draft has no added strategy)."

requirements-completed: []

# Metrics
duration: ~18min
completed: 2026-07-16
---

# Phase 111 Plan 05: Honest Scenario Commit Gate (red-team HIGH fix) Summary

Gated the Scenario Composer's Commit button on **committable** diffs (added strategies → `voluntary_add`) instead of the raw dirty count, so an exclusion-only draft can no longer advertise a "1 change" Commit that dead-ends at the misleading F-01 "Nothing to commit" error.

## The bug (red-team HIGH)

Book mode, per-key gate satisfied, no strategy added → toggle one data source off. `toggleByScopeRef[apiKeyId]=false`; the default draft has no `apiKey:` ref (`undefined !== false`) → `diffCount` counts it → the footer rendered Commit ENABLED "1 change". But `handleCommit` emits only `voluntary_add` diffs from `addedStrategies` (empty here) → `diffs.length===0` → F-01 error. The button advertised a committable change the commit path could not honor.

## The fix

- **`ScenarioFooter.tsx`** — new optional `committableCount` prop. Commit `disabled` now derives from `const canCommit = (committableCount ?? diffCount) > 0 && !commitBlocked` (was `!hasDiffs || commitBlocked`). The dirty chip + delta summary still key off `diffCount`, so exclusions keep showing as draft changes (CF-05). The prop defaults to `diffCount`, keeping display-only footers and legacy tests intact.
- **`ScenarioComposer.tsx`** — passes `committableCount={scenario.draft.addedStrategies.length}` — the exact set `handleCommit` converts to `voluntary_add` diffs.
- **F-01 guard** — left in `handleCommit` as a defense-in-depth backstop, now unreachable-by-design via the disabled button.

## Exact gate condition

`Commit disabled = (scenario.draft.addedStrategies.length === 0) || fingerprintMismatch`

## Regression tests (proven to fail without the fix)

Verified RED by temporarily neutering the footer gate back to `hasDiffs`: the following went red, then green on restore.

- **composer `111-05`** (wiring): exclusion-only draft → Commit DISABLED; exclusion still shows "1 change" (CF-05); adding a strategy → Commit ENABLED. Guards that the composer passes `addedStrategies.length`, not `diffCount`.
- **footer `T_F7b`**: `diffCount=1, committableCount=0` → disabled + no `onCommitRequested` fire + "1 change" chip; `committableCount=1` → enabled + fires.
- **footer `T_F7c`**: `committableCount` omitted → falls back to `diffCount` (legacy display-only footers unaffected).

## Deviations from Plan

### Updated pre-existing tests that encoded the pre-fix (buggy) conflation

**1. [Rule 1 - Bug] F-01 test asserted the buggy enabled-button + dead-end path**
- **Found during:** running the touched suite after the fix.
- **Issue:** `F-01: handleCommit with stale toggle …` asserted Commit ENABLED then clicked it to reach the F-01 error — i.e. it asserted the exact dead-end this fix removes.
- **Fix:** retitled/rewritten to assert the corrected behavior: the stale-toggle-only draft is dirty ("1 change") but Commit is DISABLED, and clicking the disabled button surfaces no F-01 error and never calls `onCommitRequested`. Comment documents F-01 as a retained unreachable-by-design backstop.
- **Files:** `ScenarioComposer.test.tsx`
- **Commit:** 629b89d3

**2. [Rule 1 - Bug] CR-01 saved-book round-trip test used Commit-enabled as its applied-vs-blank proxy**
- **Found during:** same suite run.
- **Issue:** `CR-01 case (a) …` asserted `Commit not disabled` to prove the saved book draft was applied (vs blank-default fallback). Under the honest model a book-only draft (holdings toggled on, no added strategy) is uncommittable, so Commit is correctly disabled — the proxy was invalid.
- **Fix:** the test's real oracle (the "3 changes" dirty chip vs blank's "No changes yet") is now the distinguishing assertion; the Commit assertion flips to `toBeDisabled()` with an explanatory comment.
- **Files:** `ScenarioComposer.test.tsx`
- **Commit:** 629b89d3

## Accepted transient (LOW — not fixed)

The red team's LOW finding — `togglePerKeySource` writing an `apiKey:`-keyed `toggleByScopeRef` entry does not bump `schema_version` — is an accepted rollout-transient. It is localStorage/save-only and self-healing (the next full save re-serializes the whole draft; there is no cross-version reader that keys behavior off these entries), so a schema bump would add migration surface with no correctness benefit. Left untouched per the plan constraint.

## Verification

- `npx tsc --noEmit` — clean.
- `npx eslint` on all 4 touched files — clean.
- `ScenarioFooter.test.tsx` + `ScenarioComposer.test.tsx` (`--no-file-parallelism`) — 186 passed.
- SC-3 freeze: `git diff --exit-code origin/main -- src/lib/scenario.ts` — clean (byte-frozen). `scenario-backbone-gates.test.ts` + `scenario-adapter.test.ts` — 28 passed. `scenario-factsheet-parity-guard.test.ts` — 11 passed.
- RED proof: neutered the footer gate → the 3 new + 2 updated regression tests failed; restored → all green.

## Self-Check: PASSED
- `ScenarioFooter.tsx`, `ScenarioComposer.tsx`, `ScenarioFooter.test.tsx`, `ScenarioComposer.test.tsx` — all present and modified in commit 629b89d3.
- Commit 629b89d3 — present on `gsd/v1.11-scenario-composer-v2`.
