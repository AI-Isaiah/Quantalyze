---
phase: 154-wizcont-stale-wizard-continuity-no-stale-screens
plan: 01
subsystem: testing
tags: [vitest, jsdom, fake-timers, supabase-js, postgrest, react-testing-library, wizard, polling]

# Dependency graph
requires:
  - phase: 154 (Task 1, orchestrator-run)
    provides: "154-INVESTIGATION.md — the PROD Q0/Q1/Q2 discriminator and the M2(ii) verdict the tests encode"
provides:
  - "T2 — the null→pending coercion pinned at the hook seam (src/hooks/useStrategySyncPoller.test.ts, the first test file this hook has ever had)"
  - "T1 / T1b / T2b — the unbounded in-flight claim, the isComposite stall gate, and the queued:false kickoff pinned at the component surface"
  - "T3 / T3b — the single-key stale refusal RED beside its composite twin GREEN; the pair is the TWIN-1 divergence"
  - "SYM-interval / INTERVAL-CTRL / LADDER-CTRL / WAITING-CTRL / REFUSAL-CTRL / DOUBLE — the green controls that stop every absence assertion being vacuous"
  - "154-INVESTIGATION.md § RED evidence + § Conclusion — the (a)/(b) shared-cause answer and the activated-plan list"
  - "154-VALIDATION.md — T-rows flipped to red-observed/green, wave_0_complete: true"
affects: [154-04, 154-07, 154-08, 154-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structural refusal probe ([data-error-code]) asserted ALONGSIDE hand-typed code needles"
    - "Twin-symmetry cases as their own it(), never a loop, so a RED/GREEN pair is the observed fact"
    - "The test double itself pinned by a case (DOUBLE:), so a later edit cannot hollow the oracle"

key-files:
  created:
    - src/hooks/useStrategySyncPoller.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale.runtime.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale-refusal.runtime.test.tsx
  modified:
    - .planning/phases/154-wizcont-stale-wizard-continuity-no-stale-screens/154-INVESTIGATION.md
    - .planning/phases/154-wizcont-stale-wizard-continuity-no-stale-screens/154-VALIDATION.md

key-decisions:
  - "T3 asserts a STRUCTURAL [data-error-code] probe in addition to the two hand-typed codes — the plan's named needle (GATE_SERIES_PROVENANCE_UNVERIFIED) would have reported T3 GREEN against the defect, because HEAD actually renders GATE_INSUFFICIENT_TRADES"
  - "Every RED case ships with a named GREEN control; a negative-only oracle is satisfied by a component that renders nothing"
  - "WAITING-CTRL and REFUSAL-CTRL state the properties a fix must NOT break — the defect is the unbounded claim, not the claim; and an unstamped series that genuinely exists still earns its refusal"
  - "Falsifiability rows SC-2a/SC-2b recorded as observed-at-HEAD with an explicit note that they must be RE-RUN against the fixed tree"

patterns-established:
  - "Twin-pin: the arm that is already correct gets its own it() in the same file as the arm that is not, so the divergence — not either arm — is the test's subject (TWIN-1, TWIN-3)"
  - "Control-for-the-control: INTERVAL-CTRL exists solely so SYM-interval cannot pass vacuously on a double that rejects rather than reads"

requirements-completed: [STALE-01]

# Metrics
duration: 22min
completed: 2026-08-12
---

# Phase 154 Plan 01: STALE-01 Investigation Gate Summary

**Five failing regression tests (T1/T1b/T2/T2b/T3) and two passing twin-symmetry pins (SYM-interval/T3b) that reproduce the 2026-08-04 stuck wizard at both of its code sites — landed RED at HEAD with zero production source modified, closing the ROADMAP criterion-2 investigation gate in the only form CONTEXT.md accepts.**

## Performance

- **Duration:** ~22 min
- **Tasks:** 2 of 3 (Task 1 was run by the orchestrator before this agent was spawned)
- **Files created:** 3 test files
- **Files modified:** 2 planning ledgers
- **Production source files modified:** **0**

## Accomplishments

- **The gate is closed on evidence, not prose.** T1, T1b, T2, T2b and T3 were observed failing against real production code; the failing output is pasted verbatim into `154-INVESTIGATION.md § RED evidence`. T3b and `SYM-interval` were observed passing. "The test covers it" was never accepted as evidence.
- **M2(ii) reproduced in isolation.** T2 drives the ladder arm through PostgREST's real `{ data: null, error: null }` zero-rows answer and observes **thirteen fabrications from thirteen empty reads** — the exact coercion (`useStrategySyncPoller.ts:228-229`) the PROD `compute_jobs` evidence implicated.
- **M1 reproduced at the surface.** T1 renders the founder's screen: `"Fetching trades..."` still on screen at **`1000s`** elapsed, offering nothing but *"you can leave this page"*. T1b names the single conjunct (`:2290-2291`) that withholds the already-built amber banner + retry affordance from exactly the users with no other exit.
- **TWIN-1 made observable as a pair.** T3 (single-key, RED) and T3b (composite, GREEN) are driven through the *identical* empty-series state by the same harness with one varying literal. One function, two arms, two answers.
- **The CONTEXT.md shared-cause question answered in writing and in tests.** One root idea, two distinct code sites; no single edit greens all three of T2, T1b and T3 — the RED set proves it rather than asserting it.

## Task Commits

1. **Task 2: Land T2 (hook) and T1/T1b/T2b (component) RED** — `8a74683f` (test)
2. **Task 3: Land T3/T3b RED and write the mechanism conclusion** — `9ab787a2` (test)

_Task 1 (`checkpoint:human-action`, the read-only PROD discriminator) was executed by the orchestrator at `3e0a41c7` — Supabase MCP tools are stripped from subagents._

## Files Created/Modified

- `src/hooks/useStrategySyncPoller.test.ts` — **NEW; this hook had no test file at all.** T2 (RED) plus `SYM-interval`, `INTERVAL-CTRL`, `LADDER-CTRL`, `DOUBLE` (GREEN). Composes the two donors named in PATTERNS §10: `renderHook` + fake timers from `useNoteAutoSave.test.ts`, the chainable Supabase double from `readfailure.runtime.test.tsx` — extended with `.single()` so BOTH arms of the hook can be driven in one file.
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale.runtime.test.tsx` — **NEW.** T1, T1b, T2b (RED) plus `WAITING-CTRL` (GREEN).
- `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale-refusal.runtime.test.tsx` — **NEW.** T3 (RED), T3b + `REFUSAL-CTRL` (GREEN).
- `154-INVESTIGATION.md` — added `## RED evidence` (pasted failing output for all five) and `## Conclusion` (verdict synthesis, the two-sites/one-root answer, the activated-plan table).
- `154-VALIDATION.md` — T-rows flipped to ❌ red-observed / ✅ green with run commands and evidence; `wave_0_complete: true`; Oracle Independence checklist discharged **scoped to the three Wave-0 files**; `nyquist_compliant` deliberately left `false` (154-08's ledger-closure call).

## Verification

| Gate | Result |
|---|---|
| Plan Task-2 `<automated>` verify | ✅ exit 1; T1, T1b, T2, T2b among failures; `SYM-interval` not among them |
| Plan Task-3 `<automated>` verify | ✅ exit 1; T3 among failures; T3b not among them; `## Conclusion` present |
| Zero production source modified | ✅ `git diff --name-only 3e0a41c7..HEAD` → only 3 test files + 2 `.planning/` files |
| No `stubGlobal` (DEF-16-1) | ✅ 0 matches in all three files, including comments |
| No threshold/closed-set imports | ✅ imports are 3 lines per file: `vitest`, `@testing-library/react`, module under test |
| `tsc --noEmit` | ✅ no errors in any new file |
| `eslint` on all three files | ✅ clean |
| Collateral breakage | ✅ `vitest run src/app/(dashboard)/strategies/new/wizard/steps src/hooks` → **520 passed, 5 failed** — the 5 failures are exactly T1/T1b/T2/T2b/T3 |

## Decisions Made

1. **T3 needles structurally, not only by name.** See Deviation 1 — this is the load-bearing decision of the plan.
2. **A named GREEN control accompanies every RED case.** `WAITING-CTRL`, `REFUSAL-CTRL`, `LADDER-CTRL`, `INTERVAL-CTRL` and `DOUBLE` are not padding: each one closes a specific way its neighbour could pass while proving nothing. `INTERVAL-CTRL` in particular exists because a double missing `.single()` would make the interval read *reject*, `onStatus` would never fire, and `SYM-interval`'s absence assertion would be satisfied by a broken harness.
3. **The controls encode what the fix must NOT do.** `WAITING-CTRL` asserts the in-flight sentence still renders *inside* the patience window (deleting the sentence is not a fix); `REFUSAL-CTRL` asserts a genuinely-existing unstamped series still earns `GATE_SERIES_PROVENANCE_UNVERIFIED` (admitting unprovenanced series is not a fix). Both redden on over-reach.
4. **Falsifiability rows recorded honestly.** SC-2a(stall), SC-2a(zero-rows) and SC-2b(stale refusal) are marked observed **with an explicit note** that HEAD *is* the mutated tree here, and that each must be re-applied and re-observed against the FIXED source by the plan that greens it. SC-2b(symmetry) is marked **pending, cannot-run-in-154-01** rather than silently ticked, because running it would require editing production source — which this plan forbids.

## Deviations from Plan

### 1. [Rule 1 — Bug in the plan's own oracle] T3's specified needle would have certified the defect

- **Found during:** Task 3, while tracing `checkStrategyGate` before writing the assertion.
- **Issue:** PLAN 154-01 and RESEARCH § Step 7 both specify `RENDERED_CODE("GATE_SERIES_PROVENANCE_UNVERIFIED")` as T3's needle. Measured, HEAD renders **`GATE_INSUFFICIENT_TRADES`**: `strategyGate.ts:322-325` guards the provenance arm with `csvRowCount > 0`, and the heal-delete window by definition has **zero** rows, so the gate falls straight through to the trade floor. **A test needling only on the provenance code would have gone GREEN against the exact tree it exists to indict** — the same "a needle that matches the wrong state cannot testify" near-miss recorded at `readfailure.runtime.test.tsx:93-107`, recurring in a new place.
- **Fix:** T3 asserts a **structural** `container.querySelector("[data-error-code]")` probe — which catches *any* refusal code — **plus** both hand-typed codes (`GATE_INSUFFICIENT_TRADES` and `GATE_SERIES_PROVENANCE_UNVERIFIED`), **plus** the absence of a `wizard_error` funnel event. The reasoning is written into the file header so a future reader cannot "simplify" it back.
- **Files modified:** `SyncPreviewStep.stale-refusal.runtime.test.tsx` (test only — no production change).
- **Verification:** T3 RED with the received DOM pasted into the ledger, showing `data-error-code="GATE_INSUFFICIENT_TRADES"`.
- **Committed in:** `9ab787a2`.

### 2. [Rule 2 — Missing critical coverage] Controls added beyond the plan's enumeration

- **Found during:** Tasks 2 and 3.
- **Issue:** The plan enumerates T1/T1b/T2/T2b/T3/T3b and one interval-symmetry case. Written to that list alone, three cases would have been satisfiable by a broken harness (see Decision 2).
- **Fix:** Added `DOUBLE:`, `LADDER-CTRL:`, `INTERVAL-CTRL:`, `WAITING-CTRL:`, `REFUSAL-CTRL:` — all GREEN at HEAD, none altering the RED set. The plan's own `<automated>` gate is unaffected: it greps only for the T-labels and `SYM-interval`.
- **Verification:** All five pass at HEAD; the RED gate output is unchanged.
- **Committed in:** `8a74683f`, `9ab787a2`.

### 3. [Rule 3 — Blocking, cosmetic] Prohibition comments reworded to keep the acceptance grep literal

- **Issue:** The Task-2 acceptance criterion is `grep -n "stubGlobal" <both files>` returns **0 matches** — with no "outside comments" qualifier (unlike the sibling criterion for the threshold constants, which explicitly permits comments). The header blocks documenting *why* the global-stub helper is forbidden contained the literal token and would have failed that grep.
- **Fix:** Reworded to "the global-stub helper (DEF-16-1 …)", preserving the prohibition and its rationale while leaving zero literal matches.
- **Verification:** `grep -c "stubGlobal"` → `0` in both files.
- **Committed in:** `8a74683f`.

---

**Total deviations:** 3 auto-fixed (1× Rule 1, 1× Rule 2, 1× Rule 3).
**Impact on plan:** No scope creep — every change is inside the plan's own files and serves the plan's stated purpose. Deviation 1 is a **correction to the plan's oracle** and is the difference between a gate and a rubber stamp; it is recorded in the ledger, not just here.

## Issues Encountered

**A second, unanticipated finding surfaced in T3's rendered DOM and is recorded rather than fixed.** The refusal the single-key arm renders during the heal-delete window is, verbatim:

> "We found only 0 filled trade(s) on this key."

That is the exact fabricated measurement phase **140.4 / C-3** was opened to delete. 140.4 closed the route where a *failed read* became a zero; here the same false sentence arrives by a *different* route — a real, successful read taken while the table was mid-delete. The class "a momentary state rendered as a fact about the user's money data" is demonstrably **not closed**. This plan lands no fix, so it is documented in `154-INVESTIGATION.md § RED evidence` for 154-08 to weigh.

**Non-issue for the record:** the commits deliberately contain failing tests. No hook blocked them and `--no-verify` was never used.

## Known Stubs

None. All three files drive the real components/hook against real production code paths.

## User Setup Required

None.

## Next Phase Readiness

- **154-04 and 154-08 are unblocked** and have a single file (`154-INVESTIGATION.md`) telling them exactly which arms to execute: 154-04 greens T2 (and T1/T2b at the surface); 154-08 greens T1b and T3.
- **154-07 must record `ARM C: NO-OP — verdict was M2(ii)`** in its SUMMARY and make no `analytics-service/` or bridge change. M3 is ruled out by Q2.
- ⚠️ **Carry-forward for 154-08 (RESEARCH A6):** adding the single-key R2-5 repoll creates a **non-throwing repoll path** in the heavy arm — precisely the case `heavyFetchErrorsRef`'s "never needs a reset" invariant did not contemplate. A stale ref could escalate a healthy run to `SYNC_FAILED`. Re-examine that invariant in the same commit.
- ⚠️ **Carry-forward for whoever greens T3:** run the SC-2b(symmetry) mutation (remove the composite arm's R2-5 guard) against the fixed tree; it could not be run here.
- ⚠️ **Census correction already recorded by Task 1:** there are **two** PROD MT5 strategies, not three. Phase 155 should not go looking for a third.
- `nyquist_compliant` is still `false` in `154-VALIDATION.md` — that is 154-08's ledger-closure call, deliberately not taken here.

## Self-Check: PASSED

All claimed artefacts verified present on disk, and both claimed commits verified in `git log`:

- ✅ `src/hooks/useStrategySyncPoller.test.ts`
- ✅ `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale.runtime.test.tsx`
- ✅ `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.stale-refusal.runtime.test.tsx`
- ✅ `154-INVESTIGATION.md` (contains `## RED evidence` and `## Conclusion`)
- ✅ `154-VALIDATION.md` (`wave_0_complete: true`; 208 lines, up from 167 — well above the plan's "pre-edit minus 5" floor)
- ✅ `8a74683f` — Task 2
- ✅ `9ab787a2` — Task 3

Neither `STATE.md` nor `ROADMAP.md` was touched (orchestrator-owned).

---
*Phase: 154-wizcont-stale-wizard-continuity-no-stale-screens*
*Plan: 01*
*Completed: 2026-08-12*
