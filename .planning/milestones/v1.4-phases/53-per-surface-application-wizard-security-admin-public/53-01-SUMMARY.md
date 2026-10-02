---
phase: 53-per-surface-application-wizard-security-admin-public
plan: 01
subsystem: ui
tags: [nextjs, react, route-states, error-boundary, loading-skeleton, vitest, a11y]

# Dependency graph
requires:
  - phase: 52-allocator-journey-per-surface-application
    provides: "route-state idiom (loading.tsx/error.tsx), Skeleton primitives, unstable_retry (Next 16.2.0) digest-only error-boundary pattern"
provides:
  - "Wizard route loading.tsx — WizardChrome-shaped Suspense fallback (4-cell stepper rail + first-step field block) with sr-only role=status liveness"
  - "Wizard route error.tsx — digest-only client error boundary (unstable_retry) covering the server-prep gap before WizardClient mounts"
  - "Strategies-list error.tsx — digest-only client error boundary (the list had loading.tsx but no error.tsx)"
  - "Verified-green frozen-behavior baseline (WizardClient transitions/autosave, localStorage step-enum, finalize-wizard POST) for Plan 02"
affects: [53-02-wizard-ux-upgrade, phase-53-state-coverage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-surface route-state files mirror src/app/strategy/[id]/error.tsx verbatim in shape; only console tag + fallback Link differ"
    - "RSC loading.tsx skeleton: single animate-pulse on the shell wrapper + Skeleton primitives + closing sr-only role=status liveness node"

key-files:
  created:
    - "src/app/(dashboard)/strategies/new/wizard/loading.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/loading.test.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/error.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/error.test.tsx"
    - "src/app/(dashboard)/strategies/error.tsx"
    - "src/app/(dashboard)/strategies/error.test.tsx"
  modified: []

key-decisions:
  - "Task 1 (pin guards) creates no files — it is a verification gate that confirms the frozen-behavior baseline green before any wizard surface is touched; recorded here, not committed separately."
  - "Wizard error.tsx fallback Link → /strategies (the surface's own list); strategies error.tsx fallback Link → /strategies/new (the surface's create action)."
  - "loading.tsx kept RSC (no 'use client'); a single shell-level animate-pulse is the sanctioned idiom — no bespoke per-element pulse divs."

patterns-established:
  - "STATE-05 route-state pair: digest-only error.tsx (T-53-01 Information Disclosure mitigation, grep error.message==0 + message-never-rendered test) co-located with its render test in the same change (coverage ratchet is a blocking CI gate)."

requirements-completed: [STATE-05, BP-02]

# Metrics
duration: ~8min
completed: 2026-06-29
---

# Phase 53 Plan 01: Wizard + Strategies Route States Summary

**Added the missing wizard `loading.tsx`/`error.tsx` and strategies-list `error.tsx` (digest-only, unstable_retry, Next 16.2.0) and pinned the wizard behavioral guards green as Plan 02's frozen-behavior baseline.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-29T16:45:00Z
- **Completed:** 2026-06-29T16:53:17Z
- **Tasks:** 3
- **Files created:** 6

## Accomplishments
- Eliminated the wizard blank-flash gap: `wizard/loading.tsx` renders a WizardChrome-shaped skeleton (4-cell stepper rail + first-step field block) at the `mx-auto max-w-3xl px-6 py-10` measure with an `sr-only role="status" aria-live="polite"` "Loading strategy setup." node.
- Gave the wizard subtree a digest-only error boundary (`wizard/error.tsx`) for the server-prep gap before `WizardClient` mounts — renders `Error ID: {digest}` only, never `error.message` (T-53-01 Information Disclosure), console tag `[wizard-error]`, fallback to `/strategies`.
- Added the strategies-list `error.tsx` (it had `loading.tsx` but no `error.tsx`) — same digest-only shape, console tag `[strategies-error]`, fallback to `/strategies/new`.
- Pinned the 3 wizard behavioral guards green (71 tests) as the recorded frozen-behavior baseline for Plan 02's review-step + inline-validation + primitive migration.

## Task Commits

Each behavior-adding task was committed atomically (TDD RED→GREEN folded into one feat commit per task, since each new route file MUST ship with its co-located render test in the same change — the coverage ratchet is a blocking CI gate):

1. **Task 1: Pin the wizard behavioral guards as the frozen-behavior baseline** — no commit (verification gate; creates no files). `WizardClient.test.tsx` + `localStorage.test.ts` + `finalize-wizard/route.test.ts` ran green: **3 files / 71 tests passed, 0 skipped.**
2. **Task 2: Add wizard loading.tsx + error.tsx** — `bbfc0be2` (feat) — 4 files (loading.tsx, loading.test.tsx, error.tsx, error.test.tsx); 8 tests.
3. **Task 3: Add strategies-list error.tsx** — `b9663837` (feat) — 2 files (error.tsx, error.test.tsx); 4 tests.

**Plan metadata:** (see final docs commit)

## Files Created/Modified
- `src/app/(dashboard)/strategies/new/wizard/loading.tsx` — RSC Suspense fallback; WizardChrome-shaped skeleton + sr-only role=status liveness.
- `src/app/(dashboard)/strategies/new/wizard/loading.test.tsx` — smoke render asserting role=status liveness + the >=4-cell stepper-rail anchor + the wizard measure.
- `src/app/(dashboard)/strategies/new/wizard/error.tsx` — "use client" digest-only error boundary (unstable_retry); never renders error.message; console tag [wizard-error]; fallback Link /strategies.
- `src/app/(dashboard)/strategies/new/wizard/error.test.tsx` — heading+body+CTA, retry-invokes-once, digest-when-present, **message-never-rendered**, fallback-Link target.
- `src/app/(dashboard)/strategies/error.tsx` — "use client" digest-only error boundary; console tag [strategies-error]; fallback Link /strategies/new.
- `src/app/(dashboard)/strategies/error.test.tsx` — heading+body+CTA, retry-invokes-once, digest-when-present, **message-never-rendered**.

## Plan-02 Frozen-Behavior Baseline (recorded per Task 1)

The following suites are GREEN on the current branch and are the falsifiable baseline Plan 02's wizard UX upgrade (review step + inline validation + primitive migration) must keep green:

```
npx vitest run \
  "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx" \
  "src/lib/wizard/localStorage.test.ts" \
  "src/app/api/strategies/finalize-wizard/route.test.ts"
→ Test Files  3 passed (3)   Tests  71 passed (71)   (0 skipped)
```

Invariant covered: WizardClient transitions + autosave, localStorage step-enum / validSteps validation, finalize-wizard POST body shape. (No new git-delta guard — Phase 53 deliberately edits WizardClient, so the invariant is BEHAVIOR, proven by these suites.)

## Verification Results
- New route-state suites: `loading.test.tsx` + `wizard/error.test.tsx` + `strategies/error.test.tsx` → **3 files / 12 tests passed.**
- Frozen baseline re-run after Tasks 2-3: **3 files / 71 tests still green** (no disturbance).
- `npm run lint` → **0 errors** (434 pre-existing no-raw-font-px warnings, all in out-of-scope files — type-migration is a later Plan; no new file emits any warning). Route-contract guard: **OK — 56 page routes + 20 admin routes all declared** (new loading/error files are not page.tsx → no manifest entry needed).
- Acceptance gates: `role="status"` in loading.tsx = 1; `unstable_retry` in both error.tsx ≥ 1; `error.message` in both error.tsx == 0; `error.digest` gate present; console tags `[wizard-error]` / `[strategies-error]` correct.
- WizardClient.tsx / WizardChrome.tsx / steps/* byte-unchanged — git diff shows ONLY the 6 new files; no deletions.

## Decisions Made
- Task 1 produces no commit (it is a green-baseline verification gate, not a code change) — recorded above as the Plan-02 reference.
- Fallback Link targets chosen per surface: wizard → `/strategies`; strategies list → `/strategies/new`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Threat Surface
T-53-01 (Information Disclosure) mitigated as planned: both new error boundaries render `error.digest` ONLY, enforced by the `grep error.message == 0` gate AND a `message-never-rendered` test assertion in each error.test.tsx (a synthetic secret in `error.message` is asserted absent from the rendered DOM). No new security-relevant surface introduced beyond the planned threat register.

## Known Stubs
None — all 6 files are functional route-state components wired to the real Next.js segment conventions and verified by render tests.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wizard surface now has complete route-state coverage (loading + error); strategies list has its error boundary.
- The frozen-behavior baseline (71 tests) is recorded and green — Plan 02 (Wave 2) can build the additive wizard UX upgrade (review step, inline validation, primitive migration) on top, with a falsifiable "did I break a transition / autosave / the POST contract?" check on every run.

## Self-Check: PASSED

All 6 created files verified present on disk; both task commits (`bbfc0be2`, `b9663837`) verified in git log.

---
*Phase: 53-per-surface-application-wizard-security-admin-public*
*Completed: 2026-06-29*
