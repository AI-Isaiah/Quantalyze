---
phase: 46-surface-by-surface-reflow
plan: 04
subsystem: testing
tags: [playwright, e2e, wcag, reflow, ci, 320px, accessibility]

# Dependency graph
requires:
  - phase: 44-foundation
    provides: "e2e/helpers/reflow.ts assertNoReflow (fail-loud 320px geometry probe) + the unseeded reflow.spec.ts / target-size.spec.ts FLOW-01 precedents"
  - phase: 45-nav
    provides: "e2e/mobile-drawer-keyboard.spec.ts seeded-auth precedent (HAS_SEED_ENV + seedTestAllocator + loginViaForm) + the app-shell <main id=main-content> landmark"
  - phase: 46-01/02/03
    provides: "the ResponsiveTable table wraps + wizard de-block that make the swept surfaces actually reflow at 320px"
provides:
  - "e2e/reflow-sweep.spec.ts — parametrized PUBLIC reflow sweep (/, /security, /for-quants, /browse, /demo) at 320px"
  - "e2e/reflow-sweep-authed.spec.ts — seeded AUTHED sweep (/allocations + 6 tabs, de-blocked wizard, authed /security) + a degenerate honest-empty route"
  - "both sweeps FLOW-01 dual-wired into ci.yml (unseeded list + seeded MA-8 list)"
  - "honest-state components (EmptyStateCard / Skeleton family / allocations EmptyState / SampleFloorEmptyState) verified fluid at 320px"
affects: [phase-47-charts-reflow, phase-48-final-a11y-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Parametrized route reflow sweep over a curated route list, each route anchored on a route-specific VISIBLE content node (never generic chrome) via assertNoReflow"
    - "FLOW-01 dual-wiring: public sweep in the unseeded ci.yml list with NO env guard; authed sweep in the seeded MA-8 list WITH the HAS_SEED_ENV self-skip"
    - "Degenerate honest-empty route anchored on the EmptyState card's own heading so a broken empty layout at 320px fails loud (REFLOW-03)"

key-files:
  created:
    - e2e/reflow-sweep.spec.ts
    - e2e/reflow-sweep-authed.spec.ts
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "320px CSS reflow width IS the WCAG 400%-zoom-on-1280 equivalent — proved REFLOW-02 via the 320px assertNoReflow pass, no separate browser-zoom mechanism (matches the phase-44 harness)"
  - "Degenerate route = a freshly-seeded 0-position allocator's /allocations EmptyState ('No positions to analyze yet.') — deterministic + visible, vs the non-deterministic <2-strategy CorrelationMatrix empty branch"
  - "Excluded admin routes from the authed sweep — seedTestAllocator stamps role='allocator', which admin/page.tsx redirects to /discovery, so an admin anchor would false-green (Pitfall 5)"
  - "Honest-state components needed ZERO code change — all four are fluid by construction (no fixed-px width; max-w-md mx-auto caps without overflow)"

patterns-established:
  - "Route-sweep specs anchor each route on a route-specific visible content node, never on app-shell chrome, so the fail-loud guard is real per route"
  - "When a doc comment would false-positive a FLOW-01 'no env guard' grep, reword the comment so the property is provable by plain grep"

requirements-completed: [REFLOW-01, REFLOW-02, REFLOW-03]

# Metrics
duration: 16min
completed: 2026-06-27
---

# Phase 46 Plan 04: All-Route Reflow Sweep + Honest-State Verification Summary

**Two parametrized Playwright reflow sweeps (public unseeded + seeded authed, with a degenerate honest-empty route) proving every curated route has no horizontal page overflow at 320px — FLOW-01 dual-wired into ci.yml and grep-proven; honest-state components verified fluid with zero code change.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-06-27T17:46:27Z
- **Completed:** 2026-06-27T18:02:31Z
- **Tasks:** 4
- **Files modified/created:** 3 (2 new e2e specs + ci.yml)

## Accomplishments
- **Public sweep** (`e2e/reflow-sweep.spec.ts`): 5 public routes (`/`, `/security`, `/for-quants`, `/browse`, `/demo`) assert no horizontal page overflow at 320px (= 400% zoom on 1280). Green locally (5 passed).
- **Authed sweep** (`e2e/reflow-sweep-authed.spec.ts`): `/allocations` + all 6 tabs (Overview/Holdings/Outcomes/Mandate/Risk/Scenario-composer), the de-blocked onboarding wizard, and authed `/security` — plus a dedicated degenerate honest-empty route (0-position allocator → EmptyState card). Parses + self-skips cleanly without seed env (10 skipped locally; CI proves execution).
- **FLOW-01 dual-wiring** grep-proven for both specs in both places (ci.yml list + spec env-guard / its deliberate absence).
- **Honest-state verification** (Task 1): all four components verified fluid at 320px — no code change needed.
- Coverage ratchet holds (lines 84.3 / stmts 82.22 / fns 77.92 / branches 74.72; gates 82/80/74/72); 566 test files, 6819 tests passed, 0 failed; `tsc --noEmit` clean.

## Task Commits

Each task was committed atomically (CODE/e2e/ci.yml only — `.planning` deliberately NOT git-added):

1. **Task 1: Verify honest-state components reflow at 320px** — no commit (verification-only; all four fluid by construction, zero code change — see Decisions)
2. **Task 2: Public unseeded sweep + unseeded ci.yml wiring** — `71b2653a` (test)
3. **Task 3: Seeded authed sweep (+ degenerate route) + seeded MA-8 ci.yml wiring** — `2f43e4c5` (test)
4. **Task 4: FLOW-01 dual-wiring proof** — `64be734e` (test; reworded the public spec's doc comment so the "no env guard" property is grep-provable)

**Plan metadata:** NOT committed — `.planning/` is gitignored local docs (a prior 46-02 executor leaked them and it had to be reverted; commit `10447e31` untracked them). SUMMARY.md / STATE.md / ROADMAP.md are written to disk only, never `git add`-ed.

## Files Created/Modified
- `e2e/reflow-sweep.spec.ts` (new) — parametrized PUBLIC reflow sweep at 320px; no env guard (FLOW-01 place 2 = deliberate absence)
- `e2e/reflow-sweep-authed.spec.ts` (new) — seeded AUTHED sweep + degenerate honest-empty route; `HAS_SEED_ENV` self-skip (FLOW-01 place 2)
- `.github/workflows/ci.yml` (modified) — appended `e2e/reflow-sweep.spec.ts` to the unseeded list (line 1059) and `e2e/reflow-sweep-authed.spec.ts` to the seeded MA-8 list (line 1263)

## FLOW-01 Dual-Wiring Proof (grep-verified locally)

Plan Task 4 automated verify command — output `FLOW-01 dual-wiring proven`, exit 0:
```
grep -q "reflow-sweep.spec.ts" .github/workflows/ci.yml \
  && grep -q "reflow-sweep-authed.spec.ts" .github/workflows/ci.yml \
  && ! grep -q "HAS_SEED_ENV" e2e/reflow-sweep.spec.ts \
  && grep -q "HAS_SEED_ENV" e2e/reflow-sweep-authed.spec.ts \
  && echo "FLOW-01 dual-wiring proven"
```

| Spec | Place 1 (ci.yml) | Place 2 (spec env-guard) |
|------|------------------|--------------------------|
| `reflow-sweep.spec.ts` (public) | unseeded list, ci.yml:1059 (same line as `e2e/reflow.spec.ts`) ✓ | NO env guard — `HAS_SEED_ENV` / `process.env.TEST_SUPABASE` literally absent from the file ✓ |
| `reflow-sweep-authed.spec.ts` (authed) | seeded MA-8 backslash-continued list, ci.yml:1263 (after `mobile-drawer-keyboard.spec.ts`, before `--timeout 60000`) ✓ | `HAS_SEED_ENV` const + `test.skip(!HAS_SEED_ENV, …)` ✓ |

## CI-Execution Directive (queued for ship/land)

⚠️ **Actual CI execution is a post-push observation.** At `/ship` or `/land`, confirm the CI run shows:
- `reflow-sweep.spec.ts` **PASSED** in the unseeded Playwright job (5 tests).
- `reflow-sweep-authed.spec.ts` **PASSED — not skipped** in the seeded MA-8 job (10 tests) when `vars.E2E_TEST_DB_CONFIGURED == 'true'`.

A `skipped` (or absent) status in the seeded job means the seed env is not wired — investigate before merge (the FLOW-01 "proven to execute" must_have).

## Decisions Made
- **Task 1 = zero code change.** All four honest-state components are fluid by construction: `EmptyStateCard` (`px-4 py-8 text-center`, no width), `Skeleton`/`SkeletonText`/`SkeletonCard` (fractional widths `w-full`/`w-2/3`/`w-1/3`, `aria-hidden`), allocations `EmptyState` (`max-w-md mx-auto` caps without overflow), `SampleFloorEmptyState` (renders `EmptyStateCard` tokens). No fixed-px width, no non-wrapping element → no overflow at 320px. No `role="alert"` added; no new empty-state component (CONTEXT forbids it).
- **Degenerate route choice.** Picked the 0-position seeded-allocator `/allocations` EmptyState ("No positions to analyze yet.") over the `CorrelationMatrix` "No correlation data available" branch: the EmptyState path is deterministic for a freshly-seeded allocator (`AllocationDashboardV2` renders it when `holdingsSummary.length === 0 && !hasSyncing`), and its `<h2>` is a real visible honest-empty node (vs the correlation empty branch, which lacks `data-testid` and depends on <2-strategy/<10-overlap data the seed doesn't set up).
- **No admin route in the authed sweep.** `seedTestAllocator` stamps `role='allocator'`; `admin/page.tsx:18` redirects a non-admin to `/discovery/crypto-sma`, so an admin anchor would false-green against the redirect (Pitfall 5). Admin-table reflow is covered by the sibling `ResponsiveTable` wraps + all-columns guards (46-01/02), not this sweep.
- **REFLOW-02 (400% zoom) via the 320px assertion.** 1280 / 4 = 320, so no horizontal overflow at 320px CSS px IS the WCAG 400%-zoom-on-1280 proof; Playwright has no separate browser-zoom mechanism and the phase-44 harness expresses the zoom case via the 320px viewport — this sweep matches that convention rather than inventing a new mechanism.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Public-spec doc comment false-positived the FLOW-01 'no env guard' grep**
- **Found during:** Task 4 (FLOW-01 dual-wiring proof)
- **Issue:** `e2e/reflow-sweep.spec.ts`'s doc comment described the seeded counterpart using the literal tokens `HAS_SEED_ENV` and `process.env.TEST_SUPABASE_*`. The plan's (and any reviewer/CI guard's) proof that the public spec has NO env guard uses `! grep -q "HAS_SEED_ENV" e2e/reflow-sweep.spec.ts` — which the comment text broke, even though the spec carries no actual guard. A false grep-fail here is exactly the FLOW-01 hygiene failure the phase guards against.
- **Fix:** Reworded the comment so the literal seed-env tokens are absent from the file; the "no env guard" property (FLOW-01 place 2 for an unseeded spec) is now provable by plain grep.
- **Files modified:** `e2e/reflow-sweep.spec.ts`
- **Verification:** Plan Task 4 verify command now prints "FLOW-01 dual-wiring proven" (exit 0); public sweep re-run still 5/5 green; `tsc --noEmit` clean.
- **Committed in:** `64be734e` (Task 4 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a self-introduced grep-provability defect).
**Impact on plan:** Surgical, test-only; necessary for the FLOW-01 must-have to be genuinely provable. No scope creep, no source changes, coverage unaffected.

## Issues Encountered
- None blocking. The authed sweep cannot run locally without seed env (by design) — confirmed it parses + self-skips (10 skipped, no crash); CI's seeded MA-8 job (gated on `vars.E2E_TEST_DB_CONFIGURED`) is where it executes for real. Recorded as the CI-execution directive above.

## Known Stubs
None. No stub patterns introduced — the sweeps are read-only DOM geometry probes; honest-state work was verification-only.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The reflow verification backbone now covers the full curated public + authed surface at 320px, ready for phases 47-48 to extend to charts (47) and final a11y verification (48) by adding routes/anchors to these sweeps.
- ⚠️ Before merge: confirm BOTH specs show PASSED-not-skipped in their respective CI jobs (the queued ship/land directive). This is the only outstanding FLOW-01 observation that cannot be made locally.

## Self-Check: PASSED

- FOUND: `e2e/reflow-sweep.spec.ts`
- FOUND: `e2e/reflow-sweep-authed.spec.ts`
- FOUND: `.planning/phases/46-surface-by-surface-reflow/46-04-SUMMARY.md`
- FOUND commits: `71b2653a`, `2f43e4c5`, `64be734e`
- FOUND ci.yml wiring: `reflow-sweep.spec.ts` (unseeded), `reflow-sweep-authed.spec.ts` (seeded MA-8)

---
*Phase: 46-surface-by-surface-reflow*
*Completed: 2026-06-27*
