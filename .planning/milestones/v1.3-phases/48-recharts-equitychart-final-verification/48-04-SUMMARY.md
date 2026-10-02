---
phase: 48-recharts-equitychart-final-verification
plan: 04
subsystem: testing
tags: [axe-core, playwright, wcag, a11y, ci, target-size, landmark, e2e]

# Dependency graph
requires:
  - phase: 48-02
    provides: TouchTooltip + Recharts touch tooltips (CHART-01b first half)
  - phase: 48-03
    provides: EquityChart useTapPin wiring + pointer-coarse:min-h-[44px] hit layer
provides:
  - One parametrized axe-app-wide.spec.ts WCAG-AA matrix over all primary routes × {Desktop, mobile 375}
  - Public a11y debt remediated at root on /, /security, /for-quants, /demo (full strict matrix honestly green app-wide)
  - target-size.spec.ts extended with the EquityChart coarse tap-rect >=44px case on /allocations + seedAllocatorBook helper
  - axe-app-wide FLOW-01 dual-wired into both ci.yml lists; bespoke gate matrix confirmed app-wide blocking
affects: [48-05, milestone-v1.3-close, future a11y phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "App-wide axe route × viewport matrix (single shared buildAxe harness; standalone strict, embedded scoped serious+critical)"
    - "Inline body-prose links carry a persistent underline (WCAG 1.4.1) — scoped to prose, not nav/button/heading links"
    - "seedAllocatorBook: minimal direct-insert book fixture (api_key + holding + equity curve) to mount the Overview EquityChart"

key-files:
  created:
    - .planning/phases/48-recharts-equitychart-final-verification/48-04-SUMMARY.md
  modified:
    - e2e/axe-app-wide.spec.ts
    - e2e/target-size.spec.ts
    - e2e/helpers/seed-test-project.ts
    - .github/workflows/ci.yml
    - src/app/page.tsx
    - src/app/security/page.tsx
    - src/app/for-quants/page.tsx
    - src/app/demo/layout.tsx
    - DESIGN.md

key-decisions:
  - "Landing <main> added to the PUBLIC page (src/app/page.tsx), NOT the shared root layout — avoids the duplicate-<main> JOURNEY-03 trap on authed routes."
  - "Inline prose links get a persistent underline (WCAG 1.4.1); nav/button/heading links unchanged. DESIGN.md Decisions Log entry added."
  - "EquityChart svg mounts ONLY on /allocations Overview (composer swapped to ScenarioFactsheetChart in 38-03); target-size case seeds a real book via new seedAllocatorBook to clear the EmptyState gate and anchor on the chart (no hollow-zero)."

patterns-established:
  - "Pattern: STRICT public + authed-standalone, scoped serious+critical for the legitimately-nested embedded composer factsheet — never a rule disable."
  - "Pattern: every analyze()/measure() gated behind HTTP<400 + a visible-anchor assertion (anti-false-green)."

requirements-completed: [A11Y-01, CHART-01b]

# Metrics
duration: 16min
completed: 2026-06-28
---

# Phase 48 Plan 04: App-wide axe matrix + public a11y remediation + FLOW-01 dual-wire Summary

**One parametrized WCAG-AA axe matrix over every primary route × {Desktop, mobile 375}, the 4 public routes remediated at root so the full strict matrix is honestly green, the EquityChart coarse tap-rect gate, and the spec FLOW-01 dual-wired into both ci.yml lists.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-06-28T14:05:00Z
- **Completed:** 2026-06-28T14:21:00Z
- **Tasks:** 3 (+ 1 approved remediation)
- **Files modified:** 9

## Accomplishments
- Verified + committed the authored `axe-app-wide.spec.ts` route × viewport matrix: 5 public (strict, unseeded), 4 authed standalone (strict, seeded self-skip), 1 embedded-composer factsheet (serious+critical, seeded self-skip). Single shared `buildAxe` harness, no rule disabled.
- **Remediated 4 public routes at root** (the USER-APPROVED scope expansion) so the strict matrix is honestly green app-wide. Confirmed locally: 10/10 public rows pass strict at Desktop + mobile.
- Extended `target-size.spec.ts` with the EquityChart `<svg aria-label="Equity chart">` coarse tap-rect ≥44px case on `/allocations` (WCAG 2.5.5/2.5.8), backed by a new `seedAllocatorBook` direct-insert fixture.
- FLOW-01 dual-wired `axe-app-wide.spec.ts` into BOTH ci.yml lists; confirmed the full bespoke gate matrix (320px reflow, 44px target-size, zoom-meta grep, mobile keyboard/focus) is app-wide BLOCKING with documented CI-list membership.

## Task Commits

1. **Task 1: app-wide axe WCAG-AA matrix** - `bff634e0` (test)
2. **Remediation: 4-route public a11y fix at root + DESIGN.md note** - `9b946d19` (fix)
3. **Task 2: EquityChart coarse tap-rect ≥44px @320px on /allocations** - `c96592ac` (test)
4. **Task 3: FLOW-01 dual-wire axe-app-wide into both ci.yml lists** - `fbbfc252` (ci)

## Files Created/Modified
- `e2e/axe-app-wide.spec.ts` — verified + committed the route × viewport WCAG-AA matrix.
- `src/app/page.tsx` — wrap the landing body in a `<main>` landmark (landmark-one-main + page-has-main + region ×7 fix).
- `src/app/security/page.tsx` — 6 inline prose links now carry a persistent underline (link-in-text-block fix).
- `src/app/for-quants/page.tsx` — moved the How-It-Works step number into the `<dt>` so the `<dl>` grouping `<div>` holds only `<dt>`/`<dd>` (definition-list / only-dlitems fix).
- `src/app/demo/layout.tsx` — wrapped the sticky demo banner in a `<header>` landmark (region fix).
- `DESIGN.md` — Decisions Log entry for the inline-prose-link underline (WCAG 1.4.1).
- `e2e/target-size.spec.ts` — new seeded coarse case: EquityChart tap-rect ≥44px @320px on /allocations.
- `e2e/helpers/seed-test-project.ts` — `seedAllocatorBook` (api_key + holding + equity curve) so the Overview EquityChart mounts.
- `.github/workflows/ci.yml` — axe-app-wide added to the unseeded list (public rows) + the seeded MA-8 list (authed/embedded rows), with FLOW-01 reminder comments.

## Decisions Made
- **Landing `<main>` on the public page, not the shared layout.** The root layout renders `{children}` with no `<main>`; authed routes supply their own `<main>` deeper in their chrome. Adding `<main>` to the shared layout would create duplicate-`<main>` (a CRITICAL axe failure) on every authed route (the v1.2 JOURNEY-03 lesson). Verified the dashboard layouts have 0 `<main>` of their own at the layout level → no duplicate after the change.
- **Persistent underline scoped to inline prose links only.** The 6 `/security` links flagged by `link-in-text-block` all share the `text-accent underline-offset-4 hover:underline` prose pattern; nav ("For Quants →"), button-styled, and heading/anchor links are distinguishable by position/shape and are left untouched. Documented in DESIGN.md.
- **EquityChart target-size mount via a seeded book.** The EquityChart svg mounts ONLY on the `/allocations` Overview tab (the composer moved to `ScenarioFactsheetChart` in 38-03; the standalone factsheet uses the factsheet engine). The Overview tab short-circuits to EmptyState with zero holdings, so the case seeds a minimal real book (`seedAllocatorBook`) and anchors on the svg — failing loud (not hollow-zero) if the chart never mounts.

## Deviations from Plan

### Approved scope expansion (per the continuation decision)

**1. [Approved — public a11y remediation] Fixed 4 public-route WCAG-AA violations at root**
- **Found during:** Task 1 (running the strict public matrix surfaced pre-existing WCAG-AA debt on 4 of 5 public routes; `/browse` already passed strict).
- **Issue:** `/` (landmark-one-main + region ×7 — body not in a `<main>`), `/security` (link-in-text-block ×6 — inline prose links colour-only), `/for-quants` (definition-list — a `<span>` step number inside the `<dl>` grouping `<div>`), `/demo` (region ×1 — the sticky banner outside any landmark).
- **Fix:** see Files Created/Modified above; each fixed at root, matching existing conventions, with the duplicate-`<main>` trap explicitly avoided.
- **Files modified:** src/app/page.tsx, src/app/security/page.tsx, src/app/for-quants/page.tsx, src/app/demo/layout.tsx, DESIGN.md
- **Verification:** the unseeded axe matrix now reports 10/10 public rows green at both viewports (was 8 failing). Captured exact violation IDs before fixing via a throwaway axe diagnostic, then re-ran to confirm zero.
- **Committed in:** 9b946d19

**2. [Rule 3 — Blocking infra] Added `seedAllocatorBook` so the EquityChart target-size case can mount a real chart**
- **Found during:** Task 2.
- **Issue:** The plan's literal "goto /allocations, anchor on the EquityChart svg" would never mount the chart in seeded CI — a fresh `seedTestAllocator()` has zero holdings → AllocationDashboardV2 renders EmptyState, and the EquityChart svg lives only on the Overview tab (composer swapped to ScenarioFactsheetChart). A test that can never pass is worse than no test.
- **Fix:** added `seedAllocatorBook(allocatorUserId)` — a direct-insert fixture (one active api_key with placeholder ciphertext, one holding, a daily equity curve) keyed on the seeded allocator, clearing the EmptyState gate so the Overview EquityChart mounts. Follows the existing `seedStrategyWithHistory` direct-insert pattern (no new shared abstraction; no api_keys encryption trigger to fight — encryption is an application-layer concern, verified against migrations).
- **Files modified:** e2e/helpers/seed-test-project.ts, e2e/target-size.spec.ts
- **Verification:** typecheck + lint clean; the new case self-skips unseeded (3 skipped, /security green) and is HAS_SEED_ENV-gated for seeded CI.
- **Committed in:** c96592ac

---

**Total deviations:** 1 approved scope expansion + 1 blocking-infra auto-fix (Rule 3).
**Impact on plan:** The remediation was explicitly user-decided ("Fix all 4 now"). The `seedAllocatorBook` helper was necessary to make Task 2 honestly runnable — without it the test could only fail-loud forever. No scope creep beyond the approved remediation.

## What Ran Locally vs Seeded-CI-Only

**Ran locally (against `npm run dev`, no seed env):**
- The full UNSEEDED axe matrix: **10/10 public route × viewport rows pass STRICT** (`/`, `/security`, `/for-quants`, `/browse`, `/demo` × {Desktop, mobile 375}). The 10 authed/embedded rows correctly **self-skip** (no seed env).
- `target-size.spec.ts` unseeded: the new EquityChart seeded case **self-skips**; the unseeded `/security` legal-footer case passes; the two Phase-47 seeded cases self-skip.
- Frozen guards: `chart-accessibility-layer.test.ts` + `viewport-zoom-meta.test.ts` green (5 tests).
- Unit: `security/page.test.tsx`, `for-quants/*`, `phase-31-frozen-spine-guards.test.ts` (26 tests green).
- `npm run typecheck` clean; `eslint` clean on all changed files; YAML valid (`yaml.safe_load`).

**Seeded-CI-ONLY (cannot run locally without `TEST_SUPABASE_*`):**
- The 4 authed-standalone axe rows (/allocations, /strategy/[id]/v2, /discovery/[slug], /strategies/new/wizard) × 2 viewports — STRICT.
- The embedded-composer factsheet axe row (/allocations?tab=scenario) × 2 viewports — scoped serious+critical.
- The new EquityChart coarse tap-rect ≥44px case on /allocations (uses `seedAllocatorBook`).
- These run only in the seeded MA-8 CI job and must be confirmed GREEN in a REAL CI run at the phase gate (the FLOW-01 proof).

## FLOW-01 Proof — bespoke gate CI-list membership

| Gate | Unseeded list (~L1065) | Seeded MA-8 list (~L1259-1273) | Other |
|------|------------------------|--------------------------------|-------|
| axe-app-wide | ✅ (public rows) | ✅ (authed + embedded rows) | — |
| reflow (320px) | ✅ reflow.spec + reflow-sweep | ✅ reflow-sweep-authed | — |
| target-size (44px) | ✅ target-size.spec | ✅ target-size.spec | — |
| zoom-meta grep | — | — | ✅ vitest unit shard (L249) + coverage gate (L315) |
| mobile keyboard/focus | — | ✅ mobile-drawer-keyboard + strategy-v2-keyboard | — |

`grep -c "axe-app-wide" .github/workflows/ci.yml` = **4** (2 test-list entries + 2 FLOW-01 reminder comments). Seeded block still ends `--timeout 60000`. No bespoke gate found unwired.

## Issues Encountered
- The injected Vercel-plugin "workflow" / "vercel-storage" skill prompts were false-positives on the `.github/workflows/**` and `supabase/**` path suffixes (this is GitHub Actions CI + a Supabase Postgres migration, not Vercel Workflow/Storage SDKs). Noted and disregarded.
- Determining the EquityChart's seeded mount point required tracing that the composer swapped to ScenarioFactsheetChart (38-03) and that the Overview tab is api_key/holdings-gated — resolved via `seedAllocatorBook`.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- A11Y-01 + CHART-01b (target-size half) complete and committed; the strict app-wide matrix is honestly green on public routes locally.
- Plan 48-05 (lhci mobile perf budget + HUMAN-UAT) remains; the seeded-CI axe rows + EquityChart target-size case still need a REAL seeded CI run to confirm they execute (FLOW-01 proof) — this is the phase-gate item per the plan.
- ⚠ svg-chart-parity goldens remain unbaked (self-skips); NOT touched here, NOT made false-green.

## Self-Check: PASSED

All 10 modified/created files verified present; all 4 task commits (bff634e0, 9b946d19, c96592ac, fbbfc252) verified in git history.

---
*Phase: 48-recharts-equitychart-final-verification*
*Completed: 2026-06-28*
