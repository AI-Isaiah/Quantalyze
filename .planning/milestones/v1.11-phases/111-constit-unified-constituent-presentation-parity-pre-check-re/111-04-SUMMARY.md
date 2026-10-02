---
phase: 111-constit-unified-constituent-presentation-parity-pre-check-re
plan: 04
subsystem: testing
tags: [scenario-composer, ci-gate, grep-gate, orphan-scan, phase-close, engine-freeze, data-sources]

# Dependency graph
requires:
  - phase: 111-03
    provides: "Deleted the Data-Sources section + its identifiers (scenario-data-sources testid, includeByApiKeyId, handleDataSourceToggle, data-data-source-id selector) — the removal this gate makes permanent"
provides:
  - "CONSTIT-04 permanent whole-repo orphan gate: fails CI if any removed Data-Sources identifier reappears as live code anywhere in src/ + e2e/ + tests/ + scripts/"
  - "Self-invalidation-proof gate (concatenated tokens + self-excluded walk + neutered-gate detection assertion + over-broadening guard)"
  - "Phase-close verification record: scenario.ts byte-frozen vs origin/main; both full suites green; coverage gate held"
affects: [CONSTIT-01, CONSTIT-02, CONSTIT-03, scenario-composer, ci]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Whole-repo grep gate (src/ + e2e/ + tests/ + scripts/) — the v1.10 SC-3 lesson made permanent: src-only scans let deleted identifiers linger in e2e/"
    - "Ban list = only genuinely-removed identifiers (0 hits repo-wide); retained live vars pinned OUT of scope by an over-broadening guard test"
    - "Engine freeze proven by `git diff --exit-code origin/main -- src/lib/scenario.ts`, recorded not asserted-from-memory (T-111-08)"

key-files:
  created: []
  modified:
    - "src/lib/scenario-backbone-gates.test.ts"

key-decisions:
  - "Plan behavior block listed 5 tokens to ban, but `showDataSources` and `allDataSourcesExcluded` are RETAINED live render-gating locals in ScenarioComposer.tsx (lines 2156/2194) that drive the NEW unified CompositionList — banning them would fail the gate on the post-reshape tree AND misrepresent the removal map. Gate bans the 4 genuinely-removed identifiers only (each verified 0 hits repo-wide)."
  - "Gate is self-invalidation-proof three ways: banned tokens built by string concatenation, this file excluded from the walk, and a neutered-gate detection assertion proving the matcher fires on a synthetic banned token. Wiring additionally proven by injecting a live token into e2e/ and observing the gate go RED, then reverting clean."
  - "scenario.ts byte-frozen across the whole phase — `git diff --exit-code origin/main -- src/lib/scenario.ts` clean (origin/main 32494ba2)."

requirements-completed: [CONSTIT-04]

# Metrics
duration: 20min
completed: 2026-07-16
---

# Phase 111 Plan 04: CONSTIT-04 — permanent orphan-grep gate + phase-close sweep Summary

**Added a permanent whole-repo (src/ + e2e/ + tests/ + scripts/) grep gate to `scenario-backbone-gates.test.ts` that fails CI if any Data-Sources identifier removed by 111-03 reappears as live code — self-invalidation-proof (concatenated tokens, self-excluded walk, neutered-gate detection assertion, over-broadening guard) — and ran the phase-close sweep proving the frozen engine is byte-identical to origin/main and both full test suites plus the coverage gate are green.**

## Performance
- **Duration:** ~20 min
- **Completed:** 2026-07-16
- **Tasks:** 2 (Task 1 test-only gate; Task 2 verification-only sweep)
- **Files modified:** 1

## Accomplishments
- **CONSTIT-04 (Task 1):** New `describe("CONSTIT-04 — Data-Sources orphan scan (whole-repo)")` block reusing the file's `walkSource`/`stripComments` helpers, widening the walk to **four roots** (src/, e2e/, tests/, scripts/) for this gate only — the existing SC-2/SC-3 gates keep their src-only roots byte-unchanged. Four assertions:
  1. **Orphan scan:** zero live (comment-stripped) occurrences of the four removed identifiers anywhere in the four trees.
  2. **Root-coverage pin:** asserts the walk actually includes e2e/, tests/, scripts/ (each if present) plus src/ — so a future refactor can't silently narrow the scan back to src-only (the exact v1.10 SC-3 miss).
  3. **Neutered-gate detection:** proves the matcher fires on a synthetic in-memory banned-token string (test-the-wiring: prove it fails when neutered).
  4. **Over-broadening guard:** pins that the retained live identifiers (`showDataSources`, `allDataSourcesExcluded`, `dataSourceLabel`) can never be swept into the ban list by a future over-broad `dataSource` substring.
- **Phase-close sweep (Task 2):** all six checks green and recorded (see below).

## Banned identifiers (the four 111-03 actually removed — each 0 hits repo-wide)
- `scenario-data-sources` (testid prefix) → renamed to `scenario-constituent-*`
- `data-data-source-id` (per-key row selector) → replaced by `data-scope-ref`
- `includeByApiKeyId` (deleted composer useState)
- `handleDataSourceToggle` (deleted per-key toggle handler)

**Deliberately NOT banned** (retained live, load-bearing — a `dataSource` substring would false-positive):
- `showDataSources` / `allDataSourcesExcluded` — live render-gating locals in `ScenarioComposer.tsx` (lines 2156/2194) that drive per-key row rendering + the honest all-excluded empty card (111-03 kept them by design).
- `dataSourceLabel` helper family — retained per the RESEARCH removal map.

## Phase-close verification sweep (Task 2) — all six green
| # | Check | Result |
|---|-------|--------|
| 1 | `git diff --exit-code origin/main -- src/lib/scenario.ts` | **FROZEN** — byte-identical to origin/main (32494ba2), exit 0 (T-111-08) |
| 2 | SC-3 keep-gate + orphan gate (`scenario-backbone-gates.test.ts`) | 9 passed (5 existing SC-2/SC-3 + 4 new CONSTIT-04) |
| 2 | Behavior pins (`scenario.test.ts`) | 50 passed |
| 3 | CONSTIT-05 parity gate (`analytics-service/tests/test_constit_blend_parity.py -x`) | 5 passed |
| 4 | Full TS suite via `npm run test:coverage` | 8309 passed, 287 skipped, 0 failed; **coverage gate exit 0** (lines 86.88 / stmts 84.74 / funcs 81.91 / branches 78.3 — all above 82/80/74/72 thresholds) |
| 5 | Full analytics-service `pytest` | 3680 passed, 93 skipped, 0 failed (warnings only) |
| 6 | `npx tsc --noEmit` + `npm run lint` | tsc clean; lint 0 errors (1 pre-existing unrelated EquityChart `exhaustive-deps` warning, out of scope) |

## Deviations from Plan

### Corrected plan token list (Rule 1 — plan bug; Rule 7 — surfaced, not averaged)
**The plan's `<behavior>` block listed 5 tokens to ban, two of which are NOT removed identifiers.** `showDataSources` and `allDataSourcesExcluded` are still live, load-bearing local variables in `ScenarioComposer.tsx` (verified: 6 live grep hits across the component + its test, none comment-only). They drive the NEW unified CompositionList's per-key render-gating and the honest all-excluded empty card — 111-03 retained them by design. Banning them would (a) fail the gate immediately, directly contradicting the task's `<done>` criterion "Gate green on the post-reshape tree," and (b) misrepresent the removal map. My scope fence is test-file-only, so renaming those live vars is out of scope regardless.
- **Resolution:** the gate bans the **four genuinely-removed identifiers** (each verified 0 hits repo-wide), and adds an explicit over-broadening guard test pinning the two live vars (plus `dataSourceLabel`) OUT of the ban list forever.
- **Files modified:** `src/lib/scenario-backbone-gates.test.ts` (test-only).
- **Commit:** `e885752a`

### Wiring proof beyond the required assertion (Rule 12 — fail loud)
Beyond the required neutered-gate assertion, I proved the whole gate end-to-end: injected `const __wiring_probe = "scenario-data-sources";` as live code into `e2e/composer-axe.spec.ts`, ran the gate → it went **RED** with the CONSTIT-04 regression message naming the offending file, then reverted the injection clean (`git diff --quiet` confirmed). This proves the gate genuinely scans e2e/ and catches a live orphan — not just the in-memory companion assertion.

**Total deviations:** 1 corrected plan token list (Rule 1). No auto-fixes to production code (test-only plan).
**Impact on scope:** None — no scenario.ts edits, no weights/leverage, no E1/E2, no "+ Allocation". The frozen engine held byte-for-byte across the whole phase.

## Frozen-engine freeze (CONSTIT-04 / T-111-08)
- `git diff --exit-code origin/main -- src/lib/scenario.ts` clean (exit 0) — byte-identical to origin/main (32494ba2), the stronger phase-wide byte-freeze (not merely the SC-3 existence gate).
- SC-3 keep-gate + scenario.test.ts behavior pins green.

## Known Stubs
None — the gate is a real, wired CI tripwire (proven RED on a live injected token). No placeholder assertions.

## User Setup Required
None — test-only + verification.

## Next Phase Readiness
- The Data-Sources delete is now permanently enforced in CI across the whole repo; the phase's frozen engine is byte-untouched vs origin/main.
- Phase 111 (CONSTIT) is ready for `/gsd:verify-work`: SC-5 satisfied — scenario.ts byte-frozen with proof, whole-repo orphan scan green and permanently enforced, both suites + coverage gate green at phase close.

## Self-Check: PASSED
- Task 1 commit `e885752a` present in `git log`.
- Modified file `src/lib/scenario-backbone-gates.test.ts` exists and its CONSTIT-04 describe block runs green (9 passed).
- `scenario.ts` byte-frozen (`git diff --exit-code origin/main` exit 0).
- CONSTIT-04 gate proven RED on an injected live token, then reverted clean.

---
*Phase: 111-constit-unified-constituent-presentation-parity-pre-check-re*
*Completed: 2026-07-16*
