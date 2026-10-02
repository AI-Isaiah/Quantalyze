---
phase: 51-shell-information-architecture-restructure
plan: 04
subsystem: ui
tags: [nextjs, route-groups, nested-layouts, seo, a11y, playwright, e2e, marketing-shell]

# Dependency graph
requires:
  - phase: 51-02
    provides: route-contract guard (pageFileToUrl strips (group) segments; PUBLIC_ROUTES lockstep) + full 57-route manifest
  - phase: 51-03
    provides: breadcrumb/sidebar a11y + PageHeader nav work (unaffected by this move)
provides:
  - "(marketing) Next route group wrapping landing + /legal/* + /for-quants + /security + /demo in ONE shared server-rendered shell (folder-only, ZERO URL change)"
  - "Shared (marketing)/layout.tsx: chrome-only masthead (Sign in/Sign up, focus-visible:ring-accent) + LegalFooter mounted once"
  - "Nested layouts preserving distinct chrome: legal tab-nav, demo notice (DemoBanner re-landmarked to region)"
  - "e2e/marketing-shell.spec.ts anon canary (status<400, same URL, single main/h1) wired into the unseeded CI list"
affects: [51-05, marketing-routes, redirects, public-seo]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Next route group (marketing) consolidates per-page marketing chrome into one shared server layout; nested layouts compose under it for route-specific chrome (no conditional logic in the shared header)"
    - "Single-landmark discipline under a shared shell: layout owns header/footer only (no <main>/<h1>/metadata); each page keeps its own <main>, single <h1>, and metadata export"
    - "Anon same-URL canary (status<400 + toHaveURL + single main/h1) as the runtime proof of the route-contract guard's build-time PUBLIC_ROUTES lockstep"

key-files:
  created:
    - "src/app/(marketing)/layout.tsx"
    - "src/app/(marketing)/legal/layout.tsx"
    - "src/app/(marketing)/demo/layout.tsx"
    - "e2e/marketing-shell.spec.ts"
  modified:
    - "src/app/(marketing)/page.tsx (landing — dropped per-page header/footer)"
    - "src/app/(marketing)/for-quants/page.tsx (wrapped body in <main>)"
    - "src/app/(marketing)/security/page.tsx (dropped masthead + LegalFooter, metadata verbatim)"
    - "src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx (repointed RequestCallModal import)"
    - ".github/workflows/ci.yml (wired marketing-shell.spec.ts into the unseeded playwright list)"

key-decisions:
  - "Route group (marketing) is folder-only — manifest/proxy/next.config UNCHANGED; the guard's pageFileToUrl already strips (group) so every URL is byte-identical"
  - "DemoBanner re-landmarked from <header> (banner) to <div role=region> so the shared masthead is the SINGLE top-level banner (avoid landmark-no-duplicate-banner axe regression)"
  - "for-quants page now owns its own <main> (its old layout.tsx — deleted — used to supply it)"
  - "Module-import paths DO include the (marketing) segment (only URLs strip it) — WizardClient import repointed accordingly"

patterns-established:
  - "Pattern 1: shared marketing shell + nested route-specific layouts under a (group), single landmark per page"
  - "Pattern 2: anon same-URL canary as the runtime twin of the route-contract build guard"

requirements-completed: [NAV-04]

# Metrics
duration: 18min
completed: 2026-06-29
---

# Phase 51 Plan 04: (marketing) Route Group — Shared Public Shell Summary

**A `(marketing)` Next route group wraps landing + /legal/* + /for-quants + /security + /demo in one shared server-rendered shell (Sign in/Sign up masthead + single LegalFooter) with ZERO URL change, per-page metadata + single main/h1 preserved, and an anon same-URL canary wired into CI.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-29T08:30:00Z
- **Completed:** 2026-06-29T08:47:22Z
- **Tasks:** 2
- **Files modified:** 22 (16 renamed, 3 deleted, 3 created + content edits)

## Accomplishments
- Introduced `src/app/(marketing)/` route group and `git mv`'d the five marketing route trees into it (history preserved, 78–100% rename similarity). Every URL is byte-unchanged — the build route table shows `/`, `/security`, `/for-quants`, `/legal/*`, `/demo`, `/demo/founder-view` with no `(marketing)` segment anywhere.
- Built the shared `(marketing)/layout.tsx` as a server component owning chrome ONLY (masthead with "Sign in"/"Sign up" + `focus-visible:ring-accent`, `min-h-[44px]` tap targets; `LegalFooter` mounted once). It renders NO `<main>`, `<h1>`, or `metadata` — each page keeps its own.
- Dropped the now-duplicated per-page headers/footers (landing, for-quants via deleted layout, security masthead + its `LegalFooter`); preserved distinct chrome as nested layouts (legal tab-nav, demo notice).
- Preserved security's `metadata` (canonical/robots/openGraph) verbatim and the landing authed `redirect("/discovery/crypto-sma")` in the page.
- Added `e2e/marketing-shell.spec.ts` anon canary — 8 routes asserting status<400 (no 307→login), `toHaveURL` (same URL), and exactly one `<main>` + one `<h1>` — and wired it into the unseeded CI playwright list. Verified GREEN 8/8 against the prod build.

## Task Commits

1. **Task 1: Create (marketing) group + move pages + nested layouts** — `8496b976` (feat)
2. **Task 2: marketing-shell anon canary + CI wiring** — `6edec594` (test)

## Files Created/Modified
- `src/app/(marketing)/layout.tsx` — shared server masthead (Sign in/Sign up) + LegalFooter, chrome-only
- `src/app/(marketing)/legal/layout.tsx` — nested layout: legal tab-nav + single `<main>` + metadata (masthead + own LegalFooter dropped)
- `src/app/(marketing)/demo/layout.tsx` — nested layout: demo notice (`role=region`, no longer a `<header>`) + single `<main>`
- `src/app/(marketing)/page.tsx` — landing; per-page header/footer removed, single `<main>` + redirect kept
- `src/app/(marketing)/for-quants/page.tsx` — body wrapped in `<main>` (old layout deleted)
- `src/app/(marketing)/security/page.tsx` — masthead + LegalFooter + unused imports dropped; metadata verbatim
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — RequestCallModal import repointed to `(marketing)` path
- `e2e/marketing-shell.spec.ts` — NEW anon same-URL single-landmark canary
- `.github/workflows/ci.yml` — appended the spec to the unseeded playwright list

## Decisions Made
- **Route group is folder-only → manifest/proxy/next.config untouched.** The 51-02 guard's `pageFileToUrl` already drops `(group)` segments (its documented example is `(marketing)/legal/page.tsx → /legal`), so the move keeps every derived URL identical; the manifest needed zero edits and the guard stays exit 0.
- **DemoBanner re-landmarked `<header>` → `<div role="region">`.** With the shared masthead now the single top-level banner, leaving the DemoBanner as a second `<header>` would trip axe `landmark-no-duplicate-banner` (the same single-landmark class JOURNEY-03 caught). The `region` landmark keeps the demo notice contained without a duplicate banner.
- **for-quants page owns its own `<main>`.** Its deleted `layout.tsx` previously supplied the `<main>`; since the shared layout adds none, the page wraps its body.
- **Module imports keep the `(marketing)` segment** (only URLs strip parens) — `WizardClient`'s `@/app/for-quants/RequestCallModal` import was repointed to `@/app/(marketing)/for-quants/RequestCallModal`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Repointed WizardClient import after the for-quants move**
- **Found during:** Task 1 (folder move)
- **Issue:** `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` imported `@/app/for-quants/RequestCallModal`; the `git mv` of `for-quants/` into `(marketing)/` broke that module path (route-group parens are stripped only from URLs, not from `@/`-alias import paths).
- **Fix:** Updated the import to `@/app/(marketing)/for-quants/RequestCallModal`.
- **Files modified:** src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
- **Verification:** `npm run build` succeeds, `tsc --noEmit` clean (0 src errors).
- **Committed in:** 8496b976 (Task 1 commit)

**2. [Rule 1 - Bug] DemoBanner duplicate-banner landmark under the shared masthead**
- **Found during:** Task 1 (preserving the demo nested layout)
- **Issue:** The shared `(marketing)/layout.tsx` renders a top-level `<header>` (banner). The demo nested layout's DemoBanner was ALSO a `<header>` — two `banner` landmarks on `/demo` = axe `landmark-no-duplicate-banner` (the single-landmark class the plan flags as NON-NEGOTIABLE).
- **Fix:** Converted the DemoBanner wrapper from `<header>` to `<div role="region" aria-label="Live demo notice">`, dropping the now-redundant "Quantalyze" wordmark (the shared masthead provides it) while keeping the demo notice + Sign up CTA.
- **Files modified:** src/app/(marketing)/demo/layout.tsx
- **Verification:** marketing-shell canary asserts exactly one `<main>` + one `<h1>` on `/demo`; demo-public.spec.ts (brand banner from the shared masthead) + demo-founder-view.spec.ts pass.
- **Committed in:** 8496b976 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking import path, 1 a11y duplicate-landmark bug)
**Impact on plan:** Both auto-fixes are correctness requirements directly caused by the folder move (a broken import and a duplicate-banner regression the shared shell introduces). No scope creep — `/browse`, `proxy.ts`, and `next.config.ts` untouched as specified.

## Issues Encountered
- **Local Playwright browser missing** (Chromium binary not installed after a Playwright update) — first canary run failed on `Executable doesn't exist`. Ran `npx playwright install chromium`; re-run is GREEN 8/8. Not a code issue (CI installs browsers).
- **Stale `.next/dev/types/validator.ts`** from a prior `next dev` session reported old-path module errors under `tsc`. Removed the stale `.next/dev` dir; `tsc --noEmit` is then fully clean. The production `next build` regenerates `.next/types/` cleanly.

## Known Stubs
None — no placeholder/empty-data stubs introduced. The new files are a chrome-only layout, two nested layouts, and an e2e spec; all wrapped pages render their existing real content.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The `(marketing)` shell is in place with the route-contract guard + anon canary proving zero URL/PUBLIC_ROUTES drift. 51-05 (any route moves/redirects) can build on the manifest's `redirectFrom` + `next.config.ts` `redirects()` lockstep (already wired in the guard, currently no redirects).
- Manual post-deploy canary (authed + anon per marketing route — 200 + canonical/metadata intact) remains as the standard prod verification step.

---
*Phase: 51-shell-information-architecture-restructure*
*Completed: 2026-06-29*

## Self-Check: PASSED

- FOUND: src/app/(marketing)/layout.tsx
- FOUND: src/app/(marketing)/legal/layout.tsx
- FOUND: src/app/(marketing)/demo/layout.tsx
- FOUND: e2e/marketing-shell.spec.ts
- FOUND: .planning/phases/51-shell-information-architecture-restructure/51-04-SUMMARY.md
- FOUND commit: 8496b976 (Task 1 — feat)
- FOUND commit: 6edec594 (Task 2 — test)
