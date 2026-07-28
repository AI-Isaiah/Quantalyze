---
phase: 44-foundation-primitives-verification-gates
plan: 04
subsystem: testing
tags: [accessibility, wcag, reflow, target-size, playwright, e2e, a11y, flow-01, mobile-adaptive-ui]

# Dependency graph
requires:
  - phase: 44-foundation-primitives-verification-gates
    provides: "demo-public.spec.ts:309-349 inline reflow walk (scrollWidth/innerWidth + toPass + offender breadcrumb) to formalize; /security public route + LegalFooter min-h-[44px] legal-nav convention"
provides:
  - "e2e/helpers/reflow.ts — reusable assertNoReflow + assertTargetSizes (route-agnostic, visible-anchor-before-measure fail-loud, clientWidth + <=1px slop, 44px bar, measured>0 false-green guard)"
  - "e2e/reflow.spec.ts — WCAG 1.4.10 reflow gate at 320px on /security, anchored on the visible H1"
  - "e2e/target-size.spec.ts — WCAG 2.5.8 target-size gate scoped to the /security LegalFooter legal-nav links (documented honestly-green scope)"
  - ".github/workflows/ci.yml — both specs wired into the UNSEEDED playwright list (FLOW-01 place 1)"
affects: [phase-45, phase-46, phase-47, phase-48, mobile-adaptive-ui, accessibility-gates]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reusable e2e DOM-geometry helpers (assertNoReflow / assertTargetSizes) taking any route + visible anchor, so phases 45-48 reuse the WCAG 1.4.10/2.5.8 measurement app-wide instead of re-deriving it"
    - "Visible-anchor-before-measure + measured>0 false-green guard: a blank/404/unhydrated page fails LOUD instead of passing against nothing (the discovery-axe Grok W-02 lesson)"
    - "UNSEEDED public-route e2e gate wired into the ci.yml unseeded playwright list with NO HAS_SEED_ENV self-skip — FLOW-01 dual-wiring (list entry + no self-disable) so the gate actually runs"
    - "Scoped target-size selector (footer nav legal links) keeps the gate honestly green WITHOUT lowering the 44px bar; app-wide rollout deferred + documented"

key-files:
  created:
    - e2e/helpers/reflow.ts
    - e2e/reflow.spec.ts
    - e2e/target-size.spec.ts
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "assertNoReflow measures documentElement.clientWidth (NOT window.innerWidth, the demo-public precedent) per SC#1 — excludes the scrollbar gutter — with a <=1px slop so sub-pixel font-hinting rounding is not flagged as a real overflow regression"
  - "Both helper functions await expect(anchor).toBeVisible() BEFORE measuring, and assertTargetSizes additionally asserts measured>0 — a blank/404/unhydrated page (e.g. an unseeded-DB render) fails LOUD rather than false-greening (Pitfall 2 / Grok W-02)"
  - "target-size.spec.ts is scoped to the /security LegalFooter legal-nav links (footer nav[aria-label='Legal'] a, all min-h-[44px]) because /security's header links, inline editorial links, anchor links, and even the PDF CTA (h-10 = 40px) are intentionally sub-44px at this phase — a page-level 44px gate would NOT be honestly green. The 44px bar is NOT lowered; the selector is scoped to a region that already meets it, with the app-wide rollout explicitly deferred to phases 46/48 in the spec header"
  - "Phase-44 reflow + target-size gates are UNSEEDED (public /security) and wired into the ci.yml unseeded list (~line 1059), NOT the seed-gated MA-8 list (1252-1262) — minimizes FLOW-01 surface and avoids a HAS_SEED_ENV self-skip that would silently disable them"

patterns-established:
  - "Pattern: reusable WCAG geometry helper (assertNoReflow/assertTargetSizes) — phases 45-48 call it with a route + visible anchor + optional scoped selector; the 44px bar and the fail-loud anchor guard live in one place"

requirements-completed: [A11Y-02]

# Metrics
duration: ~5min
completed: 2026-06-27
---

# Phase 44 Plan 04: Reflow + Target-Size e2e Gates Summary

**A reusable `e2e/helpers/reflow.ts` (`assertNoReflow` + `assertTargetSizes`) plus a 320px reflow gate and a 44px target-size gate on the public `/security` route, both FLOW-01 dual-wired into ci.yml's unseeded list — closing the two WCAG checks axe structurally cannot do (1.4.10 Reflow, 2.5.8 Target Size), with the false-green and never-run traps both designed out.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-27T12:06:28Z
- **Completed:** 2026-06-27T12:11:37Z
- **Tasks:** 3
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- New `e2e/helpers/reflow.ts` formalizes the inline reflow walk at `demo-public.spec.ts:309-349` into two reusable, route-agnostic functions:
  - `assertNoReflow(page, anchorSelector)` — asserts `documentElement.scrollWidth - clientWidth <= 1px` at the current viewport, after asserting the anchor visible; on overflow it walks `body *` to name the first offending element (`offender=TAG#id` breadcrumb).
  - `assertTargetSizes(page, anchorSelector, interactiveSelector?)` — measures each visible interactive element's `getBoundingClientRect()` against the 44px bar, skips hidden (0x0) elements, and requires `measured > 0` so an empty page / wrong selector cannot pass with zero elements measured.
- `e2e/reflow.spec.ts` sets a 320px viewport, navigates to `/security`, and calls `assertNoReflow(page, "main h1")` — anchored on the visible "Security practices" H1. No `HAS_SEED_ENV` self-skip (unseeded).
- `e2e/target-size.spec.ts` calls `assertTargetSizes(page, "main h1", 'footer nav[aria-label="Legal"] a')` — scoped to the LegalFooter legal-nav links, which are built to the `min-h-[44px]` convention and are honestly ≥44x44px. The spec header documents the scope, that the 44px bar is un-weakened, and that app-wide enforcement is phases 46/48.
- `.github/workflows/ci.yml`: both specs appended to the UNSEEDED `npx playwright test` line (~1059) — FLOW-01 place 1. Place 2 (no env self-skip) is satisfied by the specs carrying no `HAS_SEED_ENV` / `test.skip(...)`. The seed-gated MA-8 list (1252-1262) was left untouched.

## Verification Performed

- **tsc:** `npx tsc --noEmit -p tsconfig.json` — clean (exit 0). The helper + specs typecheck against `@playwright/test` (tsconfig's `**/*.ts` include covers `e2e/`).
- **ESLint:** `npx eslint e2e/helpers/reflow.ts e2e/reflow.spec.ts e2e/target-size.spec.ts` — clean (exit 0).
- **Specs pass LOCALLY:** `npx playwright test e2e/reflow.spec.ts e2e/target-size.spec.ts` → **2 passed (9.3s)** against a real local dev server (Playwright auto-started `npm run dev`). Neither skipped. This confirms `/security` has no horizontal overflow at 320px and the legal-footer nav links are ≥44px.
- **Falsifiability PROVEN (not vacuously green):** an ad-hoc throwaway probe spec (run against the live dev server, then deleted — not committed) confirmed both gates FAIL when they should:
  - `assertTargetSizes(page, "main h1", "header a")` → **FAILED** (the `/security` header text links are intentionally sub-44px).
  - `assertNoReflow(page, "h1#this-anchor-does-not-exist")` → **FAILED loud** at the `toBeVisible` anchor guard (proves the blank/404 false-green guard works).
- **Threshold un-weakened:** grep confirms `MIN_TARGET_PX = 44` and no `< 32/36/40`-style relaxation in the helper or specs.
- **FLOW-01 wiring:** `grep -F "e2e/reflow.spec.ts" .github/workflows/ci.yml` and `grep -F "e2e/target-size.spec.ts" .github/workflows/ci.yml` each return 1, both on the unseeded line; `git diff .github/workflows/ci.yml` shows ONLY the two appended names; `python3 -c "yaml.safe_load(...)"` confirms ci.yml is still valid YAML.

## PROVEN-EXECUTION in CI (SC#4 / FLOW-01) — PENDING

FLOW-01 was burned twice: a gate added but never executed in CI is a false-green. The spec-level half is proven (both specs pass locally, neither skips, falsifiability demonstrated), and the wiring is verified (grep + diff + YAML-valid). **The remaining half — confirming the CI e2e-job log shows `reflow.spec.ts` and `target-size.spec.ts` executing with `passed` (not `skipped`) in a real CI run on this branch — is PENDING the first CI run after push.** This is a known, honest post-push verification item, NOT a faked claim. Capture the CI run URL / log excerpt here once the branch's CI completes:

- [ ] CI run URL: _(fill after first push)_
- [ ] e2e job log shows `reflow.spec.ts` … `passed`
- [ ] e2e job log shows `target-size.spec.ts` … `passed`

## Deviations from Plan

None — plan executed exactly as written. The target-size scope (LegalFooter legal-nav links) was the plan's anticipated decision: the plan and RESEARCH (Open Question 1) flagged that `/security` has sub-44px targets and instructed scoping to a documented clean region without lowering the 44px bar. The chosen scope is the `min-h-[44px]` LegalFooter nav, documented in the spec header with the phase 46/48 deferral.

## Authentication Gates

None — both gates run unseeded against the public `/security` route with no auth.

## Known Stubs

None. (The two "placeholder" string matches in the spec headers refer to the CI "placeholder-env build" — the standard term for the unseeded CI environment — not UI stubs.)

## Self-Check: PASSED

- FOUND: e2e/helpers/reflow.ts
- FOUND: e2e/reflow.spec.ts
- FOUND: e2e/target-size.spec.ts
- FOUND commit 11c09710 (feat: helper)
- FOUND commit 87898f5f (test: specs)
- FOUND commit c395c1c9 (ci: FLOW-01 wiring)
