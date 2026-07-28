---
phase: 112-weights-leverage-rows-per-constituent-weights-leverage
verified: 2026-07-17T01:55:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
gaps: []
human_verification:
  - test: "Load the composer with a levered per-key constituent on a dev server; confirm the notional column reads as derived/informative (not an input) and the Sharpe/Sortino/Calmar leverage-invariance caveat is present per DESIGN.md Numbers Contract."
    expected: "Notional cell is read-only text; risk-adjusted-invariance caveat visible when a row is levered."
    why_human: "Copy/visual assertion per DESIGN.md — the wiring, structure (read-only text, caveat presence/gating) and math are already automated-covered by tests (e)/(f)/(g); only the visual copy nuance is manual. Non-blocking."
---

# Phase 112: WEIGHTS (leverage rows) — per-constituent weights + leverage — Verification Report

**Phase Goal:** An allocator sets per-strategy weights and per-row leverage directly on the unified constituent rows, and the blend re-derives from the levered daily series.
**Verified:** 2026-07-17T01:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Allocator sets per-strategy weights on the strategy-level constituent rows; weight-sum validation preserved through the collapse; renormalization over the SELECTED ENGINE UNIT basis (not `enabledIdsOf`) | VERIFIED | `ScenarioComposer.tsx:5090` renders `weight-${k.id}` per-key input → `handleWeightChange` (`:1050`) → `isPerKeyEdit` branch (`:1098`) builds a sum-1 vector over `basisIds = engineSet.strategies.filter(selected)` (`:1104`) → `applyWeightOverrides(vector, basisIds, [scopeRef])` (`:1130`). ADDED edits keep legacy `setWeightOverride` (`:1100`). Test (b) proves end-to-end renormalization K1 0.300 / K2 0.3111 / A 0.3889, sum 1. |
| 2 | Allocator adjusts per-row leverage; the blend re-derives from the levered daily series (frozen engine `wᵢ·Lᵢ·rᵢ`); no symbol-keyed engine path; leverage sanitized on read (never a zod `.min/.max` refine); per-key leverage survives Save→reopen | VERIFIED | `leverage-${k.id}` input (`:5108`) → `handleLeverageChange` (`:1138`, clamp [0,MAX_LEVERAGE]) → `leverageByRef` → projection. Test (c) proves projection volatility changes at 2× (blend re-derives via frozen engine). `pruneLeverageToDraftRefs` (`:731`) extended with `eligiblePerKeyIds` (`:734,740`) passed at BOTH save sites (POST `:1799`, PUT `:1848`); Save (a) test green. No zod refine / no symbol-keyed path in phase-112 production diff. |
| 3 | WEIGHTS-00/A1 (LOCKED): weight = equity-share; notional = equity × L is DERIVED, READ-ONLY, informative (never an input); Sharpe/Sortino/Calmar + correlation leverage-INVARIANT with honest caveat | VERIFIED | Notional rendered as read-only `<span data-testid="scenario-constituent-notional">` (`:5123,5226`) via `notionalText` (`:4977`, em-dash on null/non-finite). Test (e) asserts `tagName !== "INPUT"` and no nested input; test (f) asserts em-dash in added-only mode. Weight input `min 0 max 1` (`:5094`). Invariance caveat `scenario-leverage-invariance-note` gated on `anyLevered` (`:5251`); test (g) asserts presence-when-levered. |
| 4 | SC-3: `src/lib/scenario.ts` byte-frozen (no engine edit) | VERIFIED | `git diff --exit-code origin/main -- src/lib/scenario.ts` → exit 0 (clean). `git diff --exit-code 326cd378^..HEAD -- src/lib/scenario.ts` → CLEAN (untouched across all 9 phase-112 commits). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `ScenarioComposer.tsx` | per-key weight + leverage inputs, engine-unit-basis writer, prune fix, read-only notional, caveat | ✓ VERIFIED | +266 lines; all 5 features present and wired (grep + read confirmed) |
| `scenario-state.ts` | `applyWeightOverrides` 4th `userExplicitRefs` param | ✓ VERIFIED | `:651-688` optional param; `stampRefs = userExplicitRefs ?? refs` (diffCount honesty, back-compatible) |
| `useScenarioState.ts` | forward optional `userExplicitRefs` | ✓ VERIFIED | +16 lines; interface + useCallback forward the param |
| `src/lib/scenario.ts` | BYTE-FROZEN | ✓ VERIFIED | untouched (SC-3) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| per-key weight input | engine-unit basis | `handleWeightChange` → `applyWeightOverrides(vector, basisIds, [scopeRef])` | WIRED | `:1130`; test (b) exercises the full call site |
| per-key leverage input | frozen engine blend | `handleLeverageChange` → `leverageByRef` → projectionState → `wᵢ·Lᵢ·rᵢ` | WIRED | test (c) reads projection-derived volatility, asserts it moves |
| Save (POST + PUT) | leverage persistence | `pruneLeverageToDraftRefs(leverageByRef, draft, eligiblePerKeyIds)` | WIRED | BOTH sites `:1799` and `:1848`; Save (a) test green |
| notional `<span>` | derived read-only text | `notionalText` = share × totalBookEquity × leverage | WIRED | test (e) asserts value + non-input structure |

### Behavioral Spot-Checks / Gate Execution (run by verifier)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Composer + state test files | `npx vitest run ScenarioComposer.test.tsx ScenarioComposer.save.test.tsx scenario-state-apply-weights.test.ts --no-file-parallelism` | Test Files 3 passed · Tests 222 passed | ✓ PASS |
| Engine/backbone/leverage gate | `npx vitest run scenario-backbone-gates.test.ts scenario.test.ts leverage.test.ts --no-file-parallelism` | Test Files 3 passed · Tests 78 passed | ✓ PASS |
| SC-3 freeze vs origin/main | `git diff --exit-code origin/main -- src/lib/scenario.ts` | exit 0 (clean) | ✓ PASS |
| SC-3 freeze across phase-112 commits | `git diff --exit-code 326cd378^..HEAD -- src/lib/scenario.ts` | CLEAN | ✓ PASS |

### Negative-Constraint Checks (phase-112 production diff)

| Constraint | Result | Status |
|-----------|--------|--------|
| No new zod `.min(`/`.max(` refine on leverage/weight | None in phase-112 production diff | ✓ PASS |
| No `SCENARIO_SCHEMA_VERSION` bump | Constant value unchanged; only referenced in a test fixture (`ScenarioComposer.save.test.tsx`) | ✓ PASS |
| No symbol/coin-keyed engine path | Only match is a fence comment referencing the CONSTIT-04 grep gate — no code path | ✓ PASS |
| Production files touched | Exactly 3: ScenarioComposer.tsx, useScenarioState.ts, scenario-state.ts | ✓ PASS |

### Nyquist "test the wiring, not just the helper"

Satisfied. Tests exercise the composer CALL SITE end-to-end, not helpers in isolation:
- **(b)** renders the full composer, fires a real change on `weight-K1`, reads the resulting values across ALL THREE rendered rows and asserts sum-to-1 renormalization over the engine basis.
- **(c)** reads a projection-derived KPI (`volatility`), fires a real change on `leverage-K1`, asserts the projection changes — proving the blend re-derives through the frozen engine `wᵢ·Lᵢ·rᵢ`, not merely that `leverageByRef` mutates.
- **(e)** fires real weight + leverage edits and asserts the notional cell is read-only text with the derived value.
- State-layer GREEN pin `(c)` characterizes `setWeightOverride` on a per-key ref as the WRONG tool (mixed sum 1.4 ≠ 1), RED-proving why the engine-unit basis is required.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| WEIGHTS-01 | 112-01 | ✓ SATISFIED | per-key weight input + engine-unit-basis writer; tests state (a), composer (a-weight)/(b)/(d) green |
| WEIGHTS-02 | 112-02 | ✓ SATISFIED | per-key leverage input + Pitfall-1 prune fix + sanitize-on-read; tests (a-leverage)/(c)/save (a)/(b) green |
| SC-3 | 112-03 | ✓ SATISFIED | scenario.ts byte-frozen vs origin/main + untouched across phase commits |

### Anti-Patterns Found

None. No TBD/FIXME/XXX in the touched production files' phase-112 diff. Notional em-dash is the honest non-derivable state (not a stub). Per the SUMMARYs and confirmed by read: no placeholder returns, no empty handlers on the new inputs.

### Human Verification Required (non-blocking)

1. **Levered-KPI honesty copy** — Load the composer with a levered per-key constituent on a dev server; confirm the notional column reads as informative/derived (not an input) and the Sharpe/Sortino/Calmar leverage-invariance caveat is present per DESIGN.md Numbers Contract.
   - Expected: read-only notional text + invariance caveat rendered when a row is levered.
   - Why human: copy/visual nuance per DESIGN.md. The wiring, read-only structure (test e), em-dash fallback (test f), and caveat presence/gating (test g) are already automated-covered — this is the single visual QA check the phase's own VALIDATION.md hands to `/qa`.

### Gaps Summary

No gaps. Every must-have truth is observable in the shipped code with a passing test that exercises the call site. The engine (`scenario.ts`) is byte-frozen (SC-3). All four negative constraints (no zod refine, no schema bump, no symbol-keyed path, engine untouched) hold at the phase-112 scope. The two automated gate batteries pass (222 + 78 tests). The one manual item is a non-blocking DESIGN.md copy check whose structural/wiring aspects are already automated.

---

## Post-Verification Review Pipeline (2026-07-17, after this goal-backward pass)

The gsd-verifier above confirms GOAL delivery (goal-backward) — it is not a line-level correctness pass. A full review pipeline ran on the shipped state AFTER this verification and surfaced line-level defects the goal check is not designed to catch. All were fixed at root and re-gated green; status stays **passed** (fixes strengthened correctness, engine still frozen).

- **Opus code review** → 1 BLOCKER + 1 HIGH:
  - **CR-01** (fixed `8316c949`) — added-strategy weight edits in a MIXED book used the wrong renorm basis (`enabledIdsOf`, excludes per-key units) → typed weight not honored / sum≠1. Fixed: every weight edit in a genuinely-mixed book routes through the engine-unit basis; correct gate is `usePerKeySources && basisIds.some(id => !addedIdSet.has(id))` (a selected per-key engine unit must exist — gating on `usePerKeySources` alone regressed book-mode added-only single-unit renorm). Test (b) numbers re-derived honestly (K1 0.300 / K2 0.200 / A 0.500).
  - **WR-01** (fixed `45daffb3`) — per-key weight edits were invisible to `diffCount` (per-key refs never `toggleByScopeRef===true`) → silent wipe on entry-mode switch. Fixed: included = `!== false`; per-key override counts even with no prior default; no double-count on exclude.
- **Fable red team (round 1, on the fixed state)** → 2 CONFIRMED + 2 LOW:
  - **RT-01 HIGH** (fixed `ca1b5c3e`) — sole selected per-key unit: a typed weight was renorm-lifted to a persisted 1.0 that drifted the blend on re-include. Fixed: refuse the edit (`otherIds.length===0`) with a visible message, no poisoned override written.
  - **RT-02 MEDIUM** (fixed `4388c545`) — added-row DISPLAY basis (`perKeySources.length>0`) diverged from the edit basis → controlled-input desync. Fixed: single `isMixedPerKeyBook` memo threaded to both display and edit paths.
  - **RT-03 LOW** (fixed `32fc89a7`) — POST save-site prune wiring test added.
  - **RT-04 LOW** (documented `38632eb3`) — diffCount edit-then-revert false-positive: accepted honesty edge (heavy plumbing for a LOW; draft blob genuinely differs).
- **Fable red team (round 2, focused on the RT-01/RT-02 deltas)** → **NO DEFECTS FOUND** (3 adversarial probes run green + reverted; single-unit / all-excluded / mixed↔added transitions / memo staleness / sibling-writer paths all hold by construction). One noted residual (a draft poisoned in the pre-fix window) is a non-issue: localStorage-only on this unshipped dev branch, no migration warranted.

Final gate battery after all fixes: SC-3 `scenario.ts` byte-frozen; full allocations sweep 117 files / 1538 tests pass; engine+backbone+leverage 78 pass; tsc 0; lint 0. 6 fix commits total (`8316c949`, `45daffb3`, `ca1b5c3e`, `4388c545`, `32fc89a7`, `38632eb3`).

**Verdict: Phase 112 (WEIGHTS) COMPLETE — verified + reviewed + red-teamed clean.**

---

_Verified: 2026-07-17T01:55:00Z_
_Verifier: Claude (gsd-verifier)_
_Review pipeline appended: 2026-07-17 (code-review → 2 red-team rounds → all fixed/clean)_
