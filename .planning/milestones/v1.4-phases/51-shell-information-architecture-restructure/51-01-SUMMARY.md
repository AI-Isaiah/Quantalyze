---
phase: 51-shell-information-architecture-restructure
plan: 01
subsystem: testing
tags: [routing, ci-gate, a11y, breadcrumb, sidebar, vitest, route-contract, tdd-red]

# Dependency graph
requires:
  - phase: 45-mobile-navigation
    provides: "MobileNav aria-current + focus-visible:outline-accent pattern; buildNavSections role OR-logic (T-45-01) — the a11y + role-leak anchors this plan pins for the desktop shell"
provides:
  - "scripts/check-route-contract.ts — route-contract guard skeleton (stripComments verbatim, findRouteFiles→page.tsx, pageFileToUrl, parsePublicRoutes, runCheck with 4 STUBBED rules, dormant-under-test); 51-02 fills the rule bodies"
  - "src/lib/routing/route-contract-manifest.ts — data-only RouteClass/RouteEntry + seed ROUTE_CONTRACT_MANIFEST (imports nothing)"
  - "src/__tests__/check-route-contract.test.ts — RED guard-unit test pinning the 4 lockstep rules + the stripComments comment-bypass carve-out"
  - "Breadcrumb/Sidebar/PageHeader RED a11y tests pinning the 3 UI-SPEC a11y gaps + the NAV-02 PageHeader breadcrumb prop"
  - "Sidebar GREEN role-OR-logic pin locking T-45-01 (manager must not see allocator-only surface) on the desktop render"
affects: [51-02, 51-03, route-contract-guard, marketing-shell, breadcrumb-back-path]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RED contract precedes GREEN — the executable contract (guard skeleton + failing unit/a11y tests) ships first; 51-02/51-03 implement against a fixed target (mirrors 49-01/50-01)"
    - "Guard skeleton clone of check-admin-route-manifest.ts: fs-walk + pure runCheck(rootDir, manifest) + verbatim stripComments tokenizer + import.meta.url dormant-under-test guard"
    - "Compile-safe future-prop test: a not-yet-existent prop passed via a typed superset cast so the RED test compiles today and flips GREEN when 51-03 adds the prop"

key-files:
  created:
    - "scripts/check-route-contract.ts"
    - "src/lib/routing/route-contract-manifest.ts"
    - "src/__tests__/check-route-contract.test.ts"
    - "src/components/layout/Breadcrumb.test.tsx"
    - "src/components/layout/PageHeader.test.tsx"
  modified:
    - "src/components/layout/Sidebar.test.tsx (additive: a11y RED block + T-45-01 role-OR-logic GREEN pin)"

key-decisions:
  - "PUBLIC_ROUTES parse reads route strings from the ORIGINAL source within the located array span, using stripComments output ONLY to locate the LIVE (non-commented) `const PUBLIC_ROUTES = [` declaration — defeats the comment-bypass without losing the route literals (stripComments whitespaces string contents)"
  - "PageHeader breadcrumb prop (not on PageHeaderProps until 51-03) passed via a typed superset cast (ComponentProps<typeof PageHeader> & { breadcrumb? }) so the RED test compiles under tsc today; the cast drops in 51-03"
  - "runCheck's 4 rule bodies STUBBED (no-op, returns []) — RED by construction; the helpers (stripComments/findRouteFiles/runCheck) + import graph are FINAL so the unit test fails on assertions, never on imports"

patterns-established:
  - "Route-contract guard scaffolding: data-only manifest + cloned fs-walk guard + tmp-tree unit test (the 4-part check-admin-route-manifest recipe, applied to the page tree)"
  - "Desktop role-leak pin: a colocated Sidebar render-test mirroring the existing MobileNav T-45-01 pin so a nav-completeness edit that leaks a role surface turns red on the desktop side too"

requirements-completed: [NAV-03, NAV-02]

# Metrics
duration: 8min
completed: 2026-06-29
---

# Phase 51 Plan 01: Wave-0 Route-Contract + Shell-A11y RED Contract Summary

**Shipped the executable RED contract for Phase 51's durable win — a cloned route-contract guard skeleton + data-only manifest with a failing guard-unit test pinning the 4 lockstep rules and the stripComments comment-bypass — plus failing breadcrumb/sidebar/PageHeader a11y tests and a GREEN T-45-01 role-OR-logic pin, so 51-02/51-03 implement against a fixed target.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-29T06:01:06Z
- **Completed:** 2026-06-29T06:09Z
- **Tasks:** 3 / 3
- **Files modified:** 6 (5 created, 1 extended)

## Accomplishments

### Task 1 — Manifest type module + guard skeleton (commit `c1e8f7fc`)
- `src/lib/routing/route-contract-manifest.ts`: a pure data-only module (imports nothing — `grep -c '^import'` = 0, mirroring `rbac-manifest.ts`) exporting `RouteClass` (`public|private|admin|exception`), `RouteEntry`, and a SEED `ROUTE_CONTRACT_MANIFEST` (one entry per class: `/admin`, `/allocations`, `/api/health` exception, `/legal`). The full ~57-route population is 51-02.
- `scripts/check-route-contract.ts`: cloned from `check-admin-route-manifest.ts` — shebang + `node:fs/url/path` imports + `stripComments` tokenizer **verbatim**; `findRouteFiles` adapted to `page.tsx`; added `pageFileToUrl` (strip `src/app`, drop `(group)`, `[seg]`→`:seg`) and `parsePublicRoutes`; `runCheck(rootDir, manifest)` with the 4 RESEARCH-Pattern-4 rules **stubbed** (reachable, no-op bodies); `main()` + the `import.meta.url === file://...` dormant-under-test guard copied verbatim. NOT wired into `package.json` lint (deferred to 51-02).

### Task 2 — RED guard-unit test (commit `09a016c4`)
- `src/__tests__/check-route-contract.test.ts`: cloned the admin guard's tmp-tree harness (`mkdtempSync` + `writeRoute` + before/after). 8 `it()` blocks: PASS (public in manifest AND PUBLIC_ROUTES), Rule 2 / #512 (`MISSING-FROM-PUBLIC`), Rule 1 (`UNCLASSIFIED`), Rule 3 (`MISSING-REDIRECT`), Rule 4 (`STALE`), the comment-bypass carve-out (a commented-out `"/legal"` must still violate Rule 2), and a direct `stripComments` tokenizer pin.
- **RED by contract:** the 5 `runCheck` rule assertions fail against the stubbed `runCheck` (returns `[]`); the golden-path PASS test and the `stripComments` direct pin go green. Exit code 1; zero module-resolution errors.

### Task 3 — RED a11y/back-path tests + role pin (commit `4355a1bc`)
- **Created** `Breadcrumb.test.tsx` (RED): leaf crumb `aria-current="page"`; linked crumb `focus-visible:` + accent ring. Also a GREEN assertion that a non-leaf linked crumb is NOT `aria-current` (correct today).
- **Extended** `Sidebar.test.tsx` additively (74 insertions, 0 deletions): active `NavItemLink` `aria-current="page"` + `focus-visible:`+accent (RED); plus the **GREEN T-45-01 role-OR-logic pin** — a manager-only render does not show `My Allocation`, an allocator-only render does not show `Strategies`/`Portfolios`.
- **Created** `PageHeader.test.tsx` (RED): the `breadcrumb` prop renders a `<Breadcrumb>` landmark above the `<h1>` (RED — prop lands in 51-03, passed via a typed superset cast so it compiles); omitting the prop renders no breadcrumb landmark (GREEN non-regression).

## Verification

| Check | Result |
|-------|--------|
| `vitest run src/__tests__/check-route-contract.test.ts` RED on assertions | ✅ exit 1, 0 module-resolution errors |
| a11y tests: 3 gaps + breadcrumb-prop RED, role-OR-logic pin GREEN | ✅ 5 failed / 33 passed |
| `tsc --noEmit -p tsconfig.json` clean (no syntax/compile errors) | ✅ exit 0 (incl. the PageHeader future-prop cast) |
| `npm run lint` UNCHANGED (`check-route-contract` not in package.json) | ✅ grep = 0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a `stripComments` direct-pin assertion in the guard-unit test**
- **Found during:** Task 2
- **Issue:** The first draft of the tokenizer-pin test asserted `stripComments(proxyFixture).includes("/login")` to be `true`. That is wrong: `stripComments` whitespaces ALL string CONTENTS (not just comments), so the live `"/login"` literal is also erased post-strip. The route strings are read from the ORIGINAL source within the located array span; the stripped text is used only to LOCATE the live `const PUBLIC_ROUTES = [` declaration.
- **Fix:** Replaced the `includes("/login")` assertion with `expect(stripped).toMatch(/const PUBLIC_ROUTES\s*=\s*\[/)` — pinning the actual property the comment-bypass relies on (the live declaration survives; a commented-out one would not). Verified against the real `stripComments` output via a one-off `tsx -e` probe.
- **Files modified:** `src/__tests__/check-route-contract.test.ts`
- **Commit:** `09a016c4`

**2. [Rule 3 - Blocking] Reworded a comment to keep the `useSearchParams` contract-grep clean**
- **Found during:** Task 3
- **Issue:** The plan AC verifies `grep -c 'useSearchParams' (the 3 test files)` returns 0. A documentation comment in `Sidebar.test.tsx` contained the literal token `useSearchParams` (stating it is NOT used), tripping the grep to 1.
- **Fix:** Reworded the comment to "no query-param hook / CSR-bailout is introduced" — preserving the intent (no actual usage exists) while satisfying the literal contract grep.
- **Files modified:** `src/components/layout/Sidebar.test.tsx`
- **Commit:** `4355a1bc`

## Known Stubs

The four rule bodies inside `runCheck` (`scripts/check-route-contract.ts`) are intentionally STUBBED no-ops — this is the documented RED contract, not an accidental stub. The exported helpers (`stripComments`, `findRouteFiles`, `pageFileToUrl`, `parsePublicRoutes`) and the import graph are final. Plan 51-02 implements the rule bodies (and the full manifest population + lint wiring) to turn the guard-unit test GREEN. Each stub is annotated `STUB (51-02): ...` at its site. No stub flows to UI; this is a CI-gate skeleton by design.

## Threat Flags

None — no new security surface introduced. This plan is test-only + a dormant (un-wired) CI-gate skeleton; it changes no production route, component, or auth behavior. The threat register's three `mitigate` dispositions (T-51-01 #512 lockstep, T-51-02 role-leak, T-51-03 stripComments bypass) are each pinned by a RED/GREEN test shipped here, exactly as the plan's `<threat_model>` specifies.

## Self-Check: PASSED
