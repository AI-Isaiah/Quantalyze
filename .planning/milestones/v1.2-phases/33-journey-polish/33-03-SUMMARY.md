---
phase: 33-journey-polish
plan: 03
subsystem: a11y-e2e
tags: [accessibility, wcag-aa, axe-core, playwright, scenario-composer, journey-03]
requires:
  - "33-02 (JOURNEY-02 focus-ring fix landed in ScenarioComposer.tsx — shared file ownership, Wave 2)"
  - "e2e/helpers/axe.ts buildAxe (wcag2a+wcag2aa+best-practice)"
  - "e2e/helpers/seed-test-project.ts seedTestAllocator"
provides:
  - "e2e/composer-axe.spec.ts — authed WCAG-AA axe regression gate on /allocations?tab=scenario incl. Phase-30 cards"
affects:
  - "CI / /qa accessibility coverage (skip-gated until TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY wired)"
tech-stack:
  added: []
  patterns:
    - "Authed-seed → form-login → navigate → sanity-gate → graph-card visibility gate → axe analyze (false-green-guarded)"
key-files:
  created:
    - "e2e/composer-axe.spec.ts"
  modified: []
decisions:
  - "Reused buildAxe verbatim — no new dependency, no jest-axe, no second harness"
  - "Skip-on-no-seed + sanity heading + BOTH Phase-30 card visibility gates before analyze() (W-02 false-green guard)"
  - "Zero ScenarioComposer.tsx edit needed — no real violation surfaced; live AA scan is CI/qa-gated (not fabricated)"
metrics:
  duration: "~6 min"
  completed: "2026-06-23"
  tasks: 1
  files-created: 1
  files-modified: 0
---

# Phase 33 Plan 03: JOURNEY-03 Composer WCAG-AA Axe Spec Summary

Added one authed axe-core e2e spec (`e2e/composer-axe.spec.ts`) that scans the unified composer at `/allocations?tab=scenario` — including the Phase-30 Returns-distribution + Rolling-metrics graph cards — and asserts zero WCAG-AA violations, with a load-bearing false-green guard so it can never pass against an empty/404/login renderer.

## What Was Built

A regression gate that fails loudly if the composer (or a Phase-30 card it hosts) regresses below WCAG-AA:

- **Harness reuse (verbatim):** imports `buildAxe` from `./helpers/axe` (already `withTags(["wcag2a","wcag2aa","best-practice"])`). No new dependency (`@axe-core/playwright` already at `^4.11.2`), no jest-axe, no second harness.
- **Authed path (mirrors discovery-axe.spec.ts):** `seedTestAllocator()` (stamps a VERIFIED allocator profile + `investor_attestations` row) → `loginViaForm()` (goto /login → fill email/password → click "Sign in" → waitForURL allocations/dashboard) → `page.goto("/allocations?tab=scenario")` → `waitForLoadState("networkidle")`.
- **Triple false-green guard (T-33-06):**
  1. `test.skip(!HAS_SEED_ENV, ...)` — `TEST_SUPABASE_URL` + `TEST_SUPABASE_SERVICE_ROLE_KEY`. Authored-but-not-CI-blocking until seed env is wired; never silently passes against an unseeded DB.
  2. Sanity heading gate — `expect(page.locator("h2", { hasText: "Portfolio" }).first()).toBeVisible({ timeout: 5_000 })`. The composer composition body's `<h2>Portfolio</h2>` (ScenarioComposer.tsx:1646, alongside the PROJECTED pill + entry-mode radiogroup) — fails loudly on a 404 / empty `<main>` / login chrome.
  3. Graph-card visibility gate — `scrollIntoViewIfNeeded()` + `toBeVisible({ timeout: 10_000 })` on BOTH `[data-panel="blend-returns-distribution"]` (ScenarioComposer.tsx:2076) and `[data-panel="blend-rolling"]` (:2126) before `analyze()` (adapts the strategy-v2-axe scroll-each-card idiom).
- **Gate:** `const results = await buildAxe(page).analyze(); expect(results.violations).toEqual([]);` (AA zero-violations, matching discovery / strategy-v2 specs).
- **Extend, not duplicate:** scans the composer surface as a whole; does not re-assert the standalone-chart panels already covered in `strategy-v2-axe.spec.ts`.

## Verification

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (composer-axe) | PASS — no errors in the new spec |
| `npx eslint e2e/composer-axe.spec.ts` | PASS — exit 0 |
| `npx playwright test e2e/composer-axe.spec.ts --list` | PASS — 1 test discovered |
| `npx playwright test e2e/composer-axe.spec.ts --reporter=line` (no seed env) | PASS — `1 skipped` (NOT passed-against-empty; the W-02 skip gate fired) |
| `grep -E "disableRules\|\.exclude\(" e2e/composer-axe.spec.ts` | PASS — no matches (no rule suppression) |
| `git diff --exit-code src/lib/scenario.ts src/lib/scenario.test.ts` | PASS — frozen-spine zero-diff (SCENARIO-05) |
| `npx vitest run src/__tests__/phase-30-frozen-spine-guards.test.ts` | PASS — 3/3 (no honesty/frozen-engine regression) |

## Live AA Scan — CI/qa-gated (NOT fabricated)

The local environment has NO seed credentials (`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` both unset), so the spec correctly **skipped** rather than running the browser scan. This is the intended W-02 behaviour: the spec is authored-but-not-CI-blocking until the seed env is wired, and the skip gate guarantees it never false-greens against an unseeded DB. The live WCAG-AA scan (seed → login → render → analyze → `violations === []`) executes in CI / via `/qa` once those env vars are present. **No passing run is claimed here** — only the skip-clean, discoverable, lint/type-clean authored state.

## Root A11y Fix

None needed. No real axe violation surfaced (the local run skips before reaching `analyze()`), so `ScenarioComposer.tsx` was NOT edited — the plan's `files_modified` listed it only as the conditional root-fix target. The honesty invariants (Phase-30 disclosures, PROJECTED pill, IMPACT-02) and the frozen engine (`scenario.ts`) are untouched.

## Deviations from Plan

None — plan executed exactly as written. The spec was authored, all 7 verification gates pass, the skip gate fired cleanly (expected without seed env), and no conditional root a11y fix was triggered.

## Known Stubs

None. The spec is complete; its skip path is an intentional false-green guard (documented above), not a stub.

## Commit

- `test(33-03): JOURNEY-03 composer WCAG-AA axe e2e spec` — e2e/composer-axe.spec.ts @ `5edc4762`

## Self-Check: PASSED

- FOUND: e2e/composer-axe.spec.ts (committed @ `5edc4762`, +105 lines, single-file commit)
- FOUND: commit `5edc4762` in git log
- FOUND: .planning/phases/33-journey-polish/33-03-SUMMARY.md (on disk, gitignored — NOT committed)
- 0 `.planning` files in the commit (code-only convention honoured)
- 0 deletions in the commit
