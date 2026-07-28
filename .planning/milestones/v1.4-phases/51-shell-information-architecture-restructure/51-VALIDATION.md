---
phase: 51
slug: shell-information-architecture-restructure
status: finalized
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-29
finalized_by: planner
finalized_at: 2026-06-29
---

# Phase 51 — Validation Strategy

> Per-phase validation contract. Per-task map finalized by the planner from
> 51-RESEARCH.md §Validation Architecture + the 5 PLAN.md files.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS unit/component + guard-unit) + Playwright (e2e route-resolve canaries) + the route-contract guard script + ESLint |
| **Config file** | `vitest.config.ts` · `playwright.config.ts` · `eslint.config.mjs` · `next.config.ts` (redirects) |
| **Quick run command** | `npx vitest run <touched test file>` |
| **Full suite command** | `npm test && npm run lint` (lint runs the route-contract guard) |
| **Estimated runtime** | ~90-180 seconds (unit) · e2e route canaries separate |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched test file>`
- **After every plan wave:** `npm test && npm run lint`
- **Before `/gsd:verify-work`:** full suite green + the route-contract guard green + every moved-route redirect canary green + the (marketing) anon canary green
- **Max feedback latency:** ~180 seconds

---

## Per-Task Verification Map

> Anchored to NAV-01, NAV-02, NAV-03, NAV-04. Each task carries an `<automated>`
> verify (or a Wave-0 dependency that creates it). No 3 consecutive tasks lack
> an automated verify.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 51-01-T1 | 01 | 1 | NAV-03 | T-51-01 | guard skeleton + data-only manifest compile; runCheck/stripComments exported, dormant under vitest | unit/type | `npx tsc --noEmit` (route-contract files) | ❌ Wave 0 creates | ⬜ pending |
| 51-01-T2 | 01 | 1 | NAV-03 | T-51-01, T-51-03 | RED guard-unit test pins 4 rules + the stripComments comment-bypass | unit (guard) | `npx vitest run src/__tests__/check-route-contract.test.ts` (RED) | ❌ Wave 0 creates | ⬜ pending |
| 51-01-T3 | 01 | 1 | NAV-02 | T-51-02 | RED breadcrumb+sidebar a11y (aria-current+focus-visible) + RED PageHeader breadcrumb-prop (renders <Breadcrumb> above h1 when passed); GREEN role-OR-logic pin (T-45-01) | unit | `npx vitest run src/components/layout/Breadcrumb.test.tsx src/components/layout/Sidebar.test.tsx src/components/layout/PageHeader.test.tsx` (RED) | ❌ Breadcrumb.test.tsx + PageHeader.test.tsx CREATED here; Sidebar.test.tsx extended | ⬜ pending |
| 51-02-T1 | 02 | 2 | NAV-03 | T-51-01, T-51-04, T-51-06 | runCheck GREEN: 4 lockstep rules vs live tree; full 57-route inventory classified | unit + CI gate | `npx vitest run src/__tests__/check-route-contract.test.ts && tsx scripts/check-route-contract.ts` | ❌→✅ (51-01) | ⬜ pending |
| 51-02-T2 | 02 | 2 | NAV-03 | T-51-01, T-51-05 | guard wired into `npm run lint` + registered in CONTRACT_GUARDS; lockstep break fails CI | CI gate + contract | `npx vitest run src/__tests__/contracts/contracts-registry.test.ts && npm run lint` | ✅ extend | ⬜ pending |
| 51-03-T1 | 03 | 2 | NAV-01, NAV-02 | T-51-02, T-51-07 | sidebar aria-current+focus-visible GREEN; orphans reachable; role OR-logic byte-unchanged | unit | `npx vitest run src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx` | ✅ (RED in 51-01) | ⬜ pending |
| 51-03-T2 | 03 | 2 | NAV-02 | T-51-08 | breadcrumb aria-current+focus-visible GREEN; PageHeader breadcrumb prop GREEN; curated items (no UUID crumb) | unit | `npx vitest run src/components/layout/Breadcrumb.test.tsx src/components/layout/PageHeader.test.tsx` | ✅ (created RED in 51-01, GREEN here) | ⬜ pending |
| 51-04-T1 | 04 | 3 | NAV-04 | T-51-01, T-51-03, T-51-09 | (marketing) group: zero URL change, per-page metadata + single main/h1 preserved; guard exits 0 | build + CI gate | `npm run build && tsx scripts/check-route-contract.ts` | n/a (route move) | ⬜ pending |
| 51-04-T2 | 04 | 3 | NAV-04 | T-51-01, T-51-03 | anon canary: each marketing route <400 + single main h1 + same URL; wired into unseeded ci.yml | e2e | `npx playwright test e2e/marketing-shell.spec.ts` | ❌ Wave 0 creates | ⬜ pending |
| 51-05-T1 | 05 | 4 | NAV-01, NAV-03 | T-51-01, T-51-05, T-51-10 | /scenarios → /allocations?tab=scenario 308; manifest redirectFrom; guard Rule 3 green; no PUBLIC_ROUTES delta | build + CI gate | `npm run build && tsx scripts/check-route-contract.ts && npm run lint` | n/a (route move) | ⬜ pending |
| 51-05-T2 | 05 | 4 | NAV-01, NAV-03 | T-51-01 | anon canary: /scenarios redirects toward composer, never 307→login; wired into unseeded ci.yml | e2e | `npx playwright test e2e/route-redirects.spec.ts` | ❌ Wave 0 creates | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (finalized)

- [x] Route-contract guard skeleton + data-only manifest type module (`scripts/check-route-contract.ts`, `src/lib/routing/route-contract-manifest.ts`) — authored in 51-01, GREEN in 51-02 (cloned from `scripts/check-admin-route-manifest.ts`: fs-walk of `src/app` + cross-check `proxy.ts` PUBLIC_ROUTES + the redirect map, pure `runCheck()` entry, `npm run lint` wired, contracts-registry registered).
- [x] RED guard-unit test driving `runCheck(tmpTree, manifest)` over the 4 violation classes + the `stripComments` comment-bypass carve-out (`src/__tests__/check-route-contract.test.ts`) — 51-01.
- [x] RED breadcrumb + sidebar a11y unit tests for the 3 UI-SPEC gaps (sidebar focus-visible + aria-current; breadcrumb aria-current + focus) + a GREEN role-OR-logic pin (T-45-01) — 51-01 **creates** `Breadcrumb.test.tsx` and extends `Sidebar.test.tsx`.
- [x] RED PageHeader breadcrumb-prop test (`src/components/layout/PageHeader.test.tsx`) — 51-01 **creates** it RED (asserts the NAV-02 `breadcrumb` prop renders a `<Breadcrumb>` above the `<h1>`, and omitting it renders identically to today); GREEN in 51-03-T2 when the prop is implemented.
- [x] Per-move redirect-resolves canary (`e2e/route-redirects.spec.ts`) — created in 51-05 (the `/scenarios` move; asserts the old path lands on the composer, NOT 307→login).
- [x] (marketing) same-URL + still-public + single-landmark canary (`e2e/marketing-shell.spec.ts`) — created in 51-04.

*Existing infra (vitest, Playwright, eslint-plugin-quantalyze, contracts-registry, the admin-route-manifest precedent, the axe-app-wide PUBLIC_ROUTES matrix) covers the rest. `wave_0_complete` flips to true once 51-01's four RED files (guard-unit, Breadcrumb, Sidebar, PageHeader) + the two e2e canaries exist.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Each moved/grouped route still resolves on PROD for an authed + an unauthed user (no 307→login, no 404, no SEO regression) | NAV-03 / NAV-04 | Real prod auth + crawler behavior is runtime | Post-deploy: anon canary per (marketing) route + the /scenarios redirect; authed SSR-prop recipe (passwordless magic-link → setSession → curl → grep RSC flight) per moved route — confirm 200 + real content + canonical/metadata intact. |
| "Where am I / how do I get back" is answerable on every surface for every role | NAV-01 / NAV-02 | Human navigation judgment | Walk each role (allocator/manager/admin) through its surfaces; confirm current-location legibility (active nav + breadcrumb + H1) + a working back-path + no orphan/dead-end. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (the guard + a11y RED tests + the PageHeader breadcrumb-prop RED test + the 2 e2e canaries)
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** finalized (planner) — 2026-06-29
</content>
</invoke>
