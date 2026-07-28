---
phase: 32-dead-link-fix-route-retirement
plan: 02
subsystem: ui
tags: [nextjs16, redirect, route-retirement, supabase-rls, scenarios, composer, dead-link, flow-02, impact-02]

# Dependency graph
requires:
  - phase: 29
    provides: "Example universe absorbed into the merged Browse catalog (is_example tag) — retiring /scenarios now strands nothing"
  - phase: 30
    provides: "Composer blend panels mounted in ScenarioComposer.test.tsx (the IMPACT-02 guard runs alongside them — verified superset of the deleted Sandbox honesty test)"
provides:
  - "FLOW-02 retirement: /scenarios is a 307 redirect to /allocations?tab=scenario (the unified composer deep-link); the legacy Strategy-Sandbox surface is fully gone"
  - "Net security improvement: the createAdminClient() RLS-bypass institutional-universe read (C-0017 leak vector) is eliminated at the source"
  - "IMPACT-02 peer-rank suppression now consolidated to a single sole-coverage guard on the composer test (:2978-2993), annotated as such"
affects: [32-03 knip-gate-and-cleanup, future allocator surface consolidation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route retirement via a thin server-component redirect() from next/navigation (Next.js 16 307 default, returns never — NOT a next.config redirect, NOT permanentRedirect/308 which is CDN-cacheable)"
    - "Coverage-migration exit gate: before deleting a test file, prove the kept test is a verified superset of the deleted assertions; do NOT port assertions intrinsic to the retired surface (sandbox-example-universe-badge)"

key-files:
  created:
    - "src/app/(dashboard)/scenarios/page.test.ts"
  modified:
    - "src/app/(dashboard)/scenarios/page.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
  deleted:
    - "src/app/(dashboard)/scenarios/page.role-gate.test.ts"
    - "src/components/scenarios/ScenarioBuilder.tsx"
    - "src/components/scenarios/ScenarioBuilder.honesty.test.tsx"

key-decisions:
  - "Used redirect() from next/navigation (307 default in a Server Component, returns never → no return needed), confirmed against node_modules/next/dist/docs redirect.md per the AGENTS.md mandate. Did NOT use next.config redirect (loses auth context) nor permanentRedirect/308 (CDN-cacheable)."
  - "Dropped the old ?next=/scenarios login-bounce param: the redirect is unconditional and we never want to send anyone back to the retired surface; a logged-out user hitting /allocations is bounced to /login by the existing dashboard guards."
  - "Did NOT touch /portfolios (no route-level role gate + 25 consumers — a redirect there would strand managers; RESEARCH FLOW-02 + Pitfall 5)."
  - "Did NOT port the ScenarioBuilder-unique sandbox-example-universe-badge assertion — it is intrinsic to the retired example-universe surface; provenance now lives as the is_example Browse tag with its own Phase-29 coverage."
  - "src/lib/scenario.ts left untouched (engine pinned hard by Plan 03); the lingering ScenarioBuilder reference there is a historical provenance comment, not a live import."

patterns-established:
  - "Server-component redirect() as the canonical route-retirement primitive (preserves auth, temporary/non-cacheable)"
  - "Non-vacuous dead-link guard: assert document.querySelector('a[href=\"...\"]') is null AND the visible label text is absent in the empty-state test (fails before the link deletion)"

requirements-completed: [FLOW-02]

# Metrics
duration: 5min
completed: 2026-06-23
---

# Phase 32 Plan 02: FLOW-02 /scenarios Retirement Summary

**The legacy `/scenarios` Strategy-Sandbox surface is retired into the unified composer with zero dead links: `/scenarios/page.tsx` is now a thin server component issuing a Next.js 16 307 `redirect("/allocations?tab=scenario")`, the composer's self-referential blank-slate link is removed (no front-door loop), and `ScenarioBuilder.tsx` + its honesty test are deleted after proving the composer test (`:2978-2993`) is a verified superset of the IMPACT-02 peer-rank-suppression coverage — a net security improvement that eliminates the `createAdminClient()` RLS-bypass institutional-universe read at the source.**

## Performance

- **Duration:** ~5 min
- **Tasks:** 2
- **Files:** 1 created, 3 modified, 3 deleted

## Accomplishments

### Task 1 — /scenarios → 307 redirect; role-gate test replaced (commit 43270f7e)
- Replaced the entire `/scenarios/page.tsx` body (role gate + `createAdminClient()` read + `<ScenarioBuilder>` render + `force-dynamic`) with a 3-line server component calling `redirect("/allocations?tab=scenario")`.
- Deleted `page.role-gate.test.ts` (its admin-read assertions are now structurally false — Pitfall 3).
- Created `page.test.ts` reusing the deleted test's hoisted `redirectMock` pattern: asserts exactly one redirect to exactly `/allocations?tab=scenario` (non-vacuous — fails if the target string changes).

### Task 2 — composer self-loop removed; ScenarioBuilder retired (commit 71bec4d5)
- Deleted the blank-slate self-referential `<p>` (`ScenarioComposer.tsx` L1619-1624) linking `href="/scenarios"` ("Try the Strategy Sandbox →") — after retirement it 307-loops the user from the composer back into the composer (landmine #2). Left the sibling "Browse strategies" button + "Connect Exchange" link untouched (`Link` import still used).
- Pinned it: the `T_C1` blank-slate test now asserts the empty state has NO `a[href="/scenarios"]` and NO "Strategy Sandbox" text (non-vacuous — would have failed before the deletion).
- Verified parity, then deleted `ScenarioBuilder.tsx` + `ScenarioBuilder.honesty.test.tsx`. Added a comment at the composer's IMPACT-02 guard (`:2978-2993`) noting it is now the SOLE peer-rank-suppression coverage and a verified superset.

## Verification

- `npx vitest run "src/app/(dashboard)/scenarios/page.test.ts" "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` → 2 files / 78 tests passed.
- `npx tsc --noEmit` → exit 0.
- `git diff --exit-code src/lib/scenario.ts` → clean (engine untouched).
- Acceptance greps: `redirect("/allocations?tab=scenario")` ×1 in page.tsx; 0 forbidden tokens (`permanentRedirect`/`createAdminClient`/`ScenarioBuilder`/`force-dynamic`) in page.tsx; 0 `href="/scenarios"` and 0 `Strategy Sandbox` in ScenarioComposer.tsx; `percentile-rank-badge` ×2 in the composer test; all three deleted files absent; `SampleFloorEmptyState.tsx` retained.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two stale "Strategy Sandbox" comment references in ScenarioComposer.tsx**
- **Found during:** Task 2 (acceptance grep `grep -c 'Strategy Sandbox' == 0` failed — the plan's interface note said "the only matches were the self-loop block", but two pre-existing comments at L1992 and L2011 also referenced the now-retired "example-universe Strategy Sandbox").
- **Issue:** The Stress/VaR and Monte-Carlo section comments said those features over "the example-universe Strategy Sandbox" were deferred — a reference to a surface this plan retires, leaving a dead/stale name that breaks the acceptance criterion.
- **Fix:** Surgically reworded both comments to "an arbitrary example universe" (preserving the substantive "own-book composer ONLY; deferred" meaning), touching only the dead phrase per CLAUDE.md Rule 3 (surgical changes).
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
- **Commit:** 71bec4d5

## Threat Model Outcomes

- **T-32-03 (Information disclosure — /scenarios `createAdminClient()` read):** ELIMINATED. The retirement deletes the admin-client read entirely; the page now reads nothing and only redirects.
- **T-32-04 (Open redirect):** Accepted — the target is a hardcoded internal path, not user-controlled.
- **T-32-05 (Availability — self-loop removal):** Accepted — the blank slate still offers Browse strategies + Connect Exchange.

## Known Stubs

None.

## Self-Check: PASSED

- `32-02-SUMMARY.md` — FOUND
- `src/app/(dashboard)/scenarios/page.test.ts` — FOUND
- Commit `43270f7e` (Task 1) — FOUND
- Commit `71bec4d5` (Task 2) — FOUND
- `page.role-gate.test.ts`, `ScenarioBuilder.tsx`, `ScenarioBuilder.honesty.test.tsx` — ABSENT (deleted as planned)
