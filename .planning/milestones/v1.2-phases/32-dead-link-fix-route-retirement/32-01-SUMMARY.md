---
phase: 32-dead-link-fix-route-retirement
plan: 01
subsystem: ui
tags: [nextjs16, useSearchParams, supabase-rls, portfolio, discovery, dead-link, flow-01]

# Dependency graph
requires:
  - phase: prior
    provides: "AddToPortfolio's RLS-scoped owned-portfolio fetch + portfolio_strategies.insert path (reused unchanged)"
provides:
  - "FLOW-01 attach-back: the 2 portfolio-context add-strategy controls carry ?portfolio={id} so a strategy added on discovery attaches back to THAT portfolio"
  - "AddToPortfolio default-portfolio capability driven by the ?portfolio search param (owned-only, one-gesture auto-attach)"
  - "A /discovery/crypto-sma reference-count guard satisfied (28 intentional refs untouched)"
affects: [32-02 route-retirement, future discovery/portfolio flows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client component reads URL query state via Next.js 16 useSearchParams() (no Suspense boundary needed — the discovery page is dynamic, not prerendered)"
    - "Query-param → owned-resource match against the RLS-scoped fetch ONLY, so an unowned id is structurally a no-op (no new write path)"

key-files:
  created:
    - "src/components/portfolio/AddToPortfolio.test.tsx"
  modified:
    - "src/components/portfolio/AddToPortfolio.tsx"
    - "src/app/(dashboard)/portfolios/[id]/manage/page.tsx"
    - "src/app/(dashboard)/portfolios/[id]/page.tsx"

key-decisions:
  - "Chose RESEARCH option (b): consume ?portfolio inside AddToPortfolio via useSearchParams() (client hook), NOT a server-page prop. The discovery page therefore needs NO change."
  - "One-gesture UX = auto-invoke the existing handleAdd(matchedId) once on open when the ?portfolio id matches an owned portfolio (guarded by a ref so it fires at most once per mount)."
  - "Did NOT build on the dead ?add= param (verified zero consumers per RESEARCH Pitfall 4)."

patterns-established:
  - "useSearchParams in a client widget for portfolio-context carry-through"
  - "Owned-set membership check as the sole authorization gate for a user-controlled query param (T-32-01 mitigation)"

requirements-completed: [FLOW-01]

# Metrics
duration: 4min
completed: 2026-06-23
---

# Phase 32 Plan 01: FLOW-01 Portfolio-Context Attach-Back Summary

**The two portfolio-context "+ Add Strategy" / "Add your first strategy" links now carry `?portfolio={id}` so the already-mounted discovery `AddToPortfolio` reads the param (Next.js 16 `useSearchParams`) and auto-attaches the strategy back to that owned portfolio in one gesture — reusing the existing RLS-scoped `portfolio_strategies.insert`, no new slug or write path.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-23T18:01:09Z
- **Completed:** 2026-06-23T18:04:30Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Closed the FLOW-01 *semantic* dead link structurally: a strategy added from a portfolio's manage page or empty state now attaches back to THAT portfolio instead of being dropped on the generic discovery home with the portfolio context lost.
- `AddToPortfolio` gained an owned-only `?portfolio` default-select: on open, if the param matches one of the user's RLS-scoped owned portfolios, it auto-invokes the existing insert path (one gesture).
- Pinned the security contract with a non-vacuous test: an unowned `?portfolio` id is a no-op (never an insert target).
- Left the 28 intentional `/discovery/crypto-sma` default-landing/admin/auth/error/breadcrumb refs untouched (repo-wide count gate == 29 non-test, non-`portfolio=` lines).

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): AddToPortfolio ?portfolio default-select test** - `437c2589` (test)
2. **Task 1 (GREEN): AddToPortfolio reads ?portfolio + owned-only auto-attach** - `fd285701` (feat)
3. **Task 2: carry ?portfolio={id} on the 2 portfolio-context links** - `ab30b12d` (fix)

_TDD task 1 has two commits (test → feat); no refactor commit was needed (implementation already minimal)._

## Files Created/Modified
- `src/components/portfolio/AddToPortfolio.test.tsx` - Wave-0 tests: (a) owned-id pre-select → one-gesture insert; (b) unowned-id no-op; (c) no-param unchanged manual selection. Table-aware supabase client mock + `useSearchParams` mock.
- `src/components/portfolio/AddToPortfolio.tsx` - Reads `?portfolio` via `useSearchParams()`; after the owned-portfolio fetch resolves, auto-attaches when the id matches an owned portfolio (ref-guarded, once per mount). Insert shape unchanged.
- `src/app/(dashboard)/portfolios/[id]/manage/page.tsx` - L56 "+ Add Strategy" link now `\`/discovery/crypto-sma?portfolio=${id}\`` (`id` already awaited at L20).
- `src/app/(dashboard)/portfolios/[id]/page.tsx` - `EmptyState` now takes a `portfolioId` prop and carries it on the "Add your first strategy" link; the render site passes the page-level `id`.

## Decisions Made
- **Param-consumption approach: `useSearchParams()` inside `AddToPortfolio` (RESEARCH option b), NOT a server-page prop.** This is consistent across both tasks: Task 2 therefore makes NO change to the discovery strategy-detail page (`discovery/[slug]/[strategyId]/page.tsx`) beyond confirming it still mounts `<AddToPortfolio strategyId={strategy.id} />` unchanged. Rationale: minimal new surface, no async-`searchParams` plumbing through the server page, and the component already owns the owned-portfolio fetch.
- **No Suspense boundary added.** Next.js 16's `useSearchParams` only forces a CSR bailout when a route is *prerendered*; the discovery detail page is dynamic (`await params`, `supabase.auth.getUser()`), so no Suspense wrapper is required. tsc + lint + tests all green.
- **One-gesture = auto-attach on open** (not "open dropdown pre-highlighted"). Opening the dropdown is the only user action; the matched owned portfolio is attached immediately via the existing `handleAdd`.

## Deviations from Plan

None - plan executed exactly as written. (The plan explicitly left the param-consumption approach to the executor; option (b)/`useSearchParams` was chosen and applied consistently across both tasks.)

## Issues Encountered
None. The initial RED run failed exactly on the intended new-behavior test (one-gesture pre-select) while the no-op and no-param cases already passed under current behavior — confirming a correct RED before implementation.

## Threat Flags
None - no new security-relevant surface beyond the plan's threat model. T-32-01 (user-controlled `?portfolio` id) is mitigated by matching against the RLS-scoped owned set only; T-32-02 (uuid in URL) accepted per plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FLOW-01 attach-back complete and tested. Ready for 32-02 (route retirement: `/scenarios` → redirect, ScenarioBuilder deletes, Sidebar item removal per RESEARCH FLOW-02).
- Guard in place: the `/discovery/crypto-sma` reference-count gate (== 29 non-test, non-`portfolio=`) protects the 28 intentional default-landing redirects from accidental edits.

## Self-Check: PASSED

All created/modified files verified present on disk; all 3 task commits (`437c2589`, `fd285701`, `ab30b12d`) verified in git history.

---
*Phase: 32-dead-link-fix-route-retirement*
*Completed: 2026-06-23*
