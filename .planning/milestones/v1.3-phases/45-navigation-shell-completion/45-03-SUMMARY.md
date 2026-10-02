---
phase: 45-navigation-shell-completion
plan: 03
subsystem: e2e
tags: [playwright, e2e, a11y, keyboard, inert, skip-link, focus-trap, mobile, flow-01, ci]

# Dependency graph
requires:
  - phase: 45-navigation-shell-completion
    provides: "45-01: <main id=main-content inert={menuOpen}>, a.app-skip-link, nav[aria-label='Primary mobile'], #mobile-sidebar-drawer[role=dialog], hamburger 'Open menu'"
  - phase: 44-mobile-foundation
    provides: "e2e/helpers/reflow.ts assertNoReflow/assertTargetSizes; two-tier Playwright CI (unseeded + seeded MA-8)"
provides:
  - "e2e/mobile-drawer-keyboard.spec.ts — seeded authed proof of drawer focus containment + skip-link + background-inert + 320px nav-shell reflow/targets (NAV-03 + SC#4)"
  - "ci.yml MA-8 seeded list entry for the new spec (FLOW-01 place 1 of 2)"
affects: [46-surface-reflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Seeded authed keyboard-a11y e2e mirroring composer-axe.spec.ts (seedTestAllocator + loginViaForm + HAS_SEED_ENV self-skip + fail-loud visible anchors), NOT the dead strategy-v2-keyboard.spec.ts test.skip(true)"
    - "Focus-containment assertion via document.activeElement + Element.contains across Tab/Shift+Tab presses, plus an explicit inert-attribute probe on the background <main> as the structural barrier (behaviour AND attribute proven)"
    - "FLOW-01 dual-wiring: a seed-gated spec lives in BOTH its own HAS_SEED_ENV guard AND the ci.yml MA-8 list; proven-execution (passed not skipped) is an explicit post-push human-verify must_have"

key-files:
  created:
    - "e2e/mobile-drawer-keyboard.spec.ts"
  modified:
    - ".github/workflows/ci.yml"

key-decisions:
  - "Used an explicit inert-ATTRIBUTE probe (hasAttribute('inert') on #main-content) in ADDITION to the behavioural containment loop — the behaviour is also defended by the drawer's existing manual Tab trap, so without the attribute probe the test could pass even if inert were silently dropped (Rule 9: test intent, not just behaviour)"
  - "Skip-link assertion blurs activeElement + focuses document.body before the first Tab to get a deterministic first-tab-stop, then asserts a.app-skip-link is focused (first focusable) and Enter moves focus to #main-content (id probe)"
  - "Drawer-links-focusable guard kept as a distinct assertion block (RESEARCH Pitfall 2 ancestor-inert regression) so a future accidental inert on the drawer/ancestor fails loudly and specifically"
  - "Containment loop runs 6 Tab + 6 Shift+Tab presses (> the drawer's focusable count) so the wrap-around path through first/last is exercised in both directions"
  - "Authed spec wired ONLY to the seeded MA-8 list (ci.yml ~1262), never the unseeded :1059 list"

# Metrics
duration: 3min
completed: 2026-06-27
---

# Phase 45 Plan 03: Drawer-keyboard + skip-link + nav-shell e2e (NAV-03 verification) Summary

**A SEEDED authed Playwright spec (`e2e/mobile-drawer-keyboard.spec.ts`) that proves the Plan 45-01 drawer hardening: skip-link is the first focusable and jumps to `#main-content`, focus moves into the drawer on open, Tab/Shift+Tab stay contained inside `#mobile-sidebar-drawer` while the background `<main>` is `inert`, Escape restores focus to the hamburger, and at 320px the nav shell does not reflow with bottom-nav/hamburger targets ≥44px — dual-wired into BOTH FLOW-01 sites.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-27T13:35Z
- **Completed:** 2026-06-27T13:38Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- **NAV-03 (verification half):** new `e2e/mobile-drawer-keyboard.spec.ts` (seeded authed, mirroring `composer-axe.spec.ts`) asserts the full keyboard-a11y contract Plan 45-01 implemented:
  - **(a) Skip-link first + jump:** from a neutral focus origin, the first Tab lands on `a.app-skip-link[href="#main-content"]` ("Skip to main content"); Enter moves focus to `<main id="main-content">` (asserted via `document.activeElement.id`).
  - **(b) Focus-in on open:** tapping the `"Open menu"` hamburger moves focus to the first `#mobile-sidebar-drawer a[href]`.
  - **(c) Drawer links focusable while open:** an explicit guard against an accidental ancestor-`inert` regression (RESEARCH Pitfall 2).
  - **(d) Containment + inert barrier:** the background `<main id="main-content">` carries the `inert` attribute while open (attribute probe), and across 6 Tab + 6 Shift+Tab presses `document.activeElement` always stays inside `#mobile-sidebar-drawer` and never inside `#main-content`.
  - **(e) Restore on close:** Escape hides the drawer and restores focus to the hamburger.
  - **(f) SC#4 nav shell at 320px:** reuses the Phase 44 `assertNoReflow(page, "nav[aria-label='Primary mobile']")` and `assertTargetSizes(...)` so the bottom-nav cells (min-h-[44px] from Plan 45-01) + the hamburger all measure ≥44px with no horizontal reflow.
- **FLOW-01 dual-wiring (the twice-burned trap) closed in BOTH places:**
  - Place 1: `e2e/mobile-drawer-keyboard.spec.ts` added to the seeded MA-8 `npx playwright test` list (`ci.yml:1262`), after `composer-axe.spec.ts`, before `--timeout 60000`.
  - Place 2: the spec declares `const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;` + `test.skip(!HAS_SEED_ENV, ...)`.
- **Fail-loud throughout:** the hamburger visible-anchor gate, the drawer `[role="dialog"]` visible gate, and the helper anchors all fail LOUD on a 404 / login / unseeded page rather than false-greening (the W-02 lesson).

## Task Commits

1. **Task 1: the seeded drawer-keyboard spec** — `403fbcc6` (test)
2. **Task 2: ci.yml MA-8 wiring (FLOW-01 place 1)** — `e2ad904f` (ci)

## Files Created/Modified

- `e2e/mobile-drawer-keyboard.spec.ts` (created, 213 lines) — seeded authed spec; `seedTestAllocator` + `loginViaForm` (mirrors composer-axe), `HAS_SEED_ENV` self-skip, fail-loud anchors, skip-link/focus-in/containment/inert-attribute/restore assertions, Phase 44 reflow + target-size helpers at 320px.
- `.github/workflows/ci.yml` (modified, +1 line) — added the spec to the seeded MA-8 list only; env block / upload-skip gate / kill-wait lines byte-unchanged.

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit -p tsconfig.json` | PASS (exit 0, no errors) |
| `npx playwright test e2e/mobile-drawer-keyboard.spec.ts --list` | PASS — 1 test discovered (`...:75:7`) |
| `grep -c HAS_SEED_ENV` (spec) | 4 (≥2 — const + skip) |
| `grep -c seedTestAllocator` (spec) | 5 (≥1) |
| `grep -c strategy-v2-keyboard` (spec) | 0 (mirrors LIVE pattern, not the dead one) |
| `grep -cE 'assertNoReflow\|assertTargetSizes'` (spec) | 4 (≥2 — both helpers) |
| `grep -c '#main-content'` / `Skip to main content` / `Primary mobile` / `mobile-sidebar-drawer` (spec) | 7 / 2 / 2 / 6 (all ≥1) |
| `grep -c mobile-drawer-keyboard.spec.ts` (ci.yml) | 1 (exactly once, MA-8) |
| ci.yml entry line number | 1262 (in MA-8, >1240, not 1059) |
| `git diff --stat .github/workflows/ci.yml` | 1 insertion only |
| spec line count | 213 (≥60 min_lines) |

## Local-execution status (honest)

The spec was **NOT run locally**: the seed env vars (`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`) are **unset** in this environment (verified — both UNSET in shell and absent from `.env.local`), and no seeded test DB + production-mode dev server is available here. Running it locally now would self-skip (`HAS_SEED_ENV` false), which proves nothing. Per the plan's explicit instruction, local execution was substituted with compile + discovery proof: `tsc --noEmit` clean and `playwright test --list` discovers the test.

## CI-execution proof: PENDING (post-push human-verify)

The MUST_HAVE "proven to execute in CI (passed, not skipped)" can only be confirmed AFTER this branch's first CI run, where `vars.E2E_TEST_DB_CONFIGURED` + the `TEST_SUPABASE_*` secrets make `HAS_SEED_ENV` true. **This is a known, explicit post-push human-verify item, NOT faked.**

**To verify after push:** in the seed-gated e2e job log, confirm `e2e/mobile-drawer-keyboard.spec.ts` appears as `passed` (not `skipped`, not absent), and that `e2e/composer-axe.spec.ts` (JOURNEY-03) stays green in the same MA-8 run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] JSDoc token tripped a Task 1 acceptance grep**
- **Found during:** Task 1 acceptance verification.
- **Issue:** The acceptance criterion `grep -c "strategy-v2-keyboard" == 0` failed (returned 1) because the spec's header JSDoc named the dead spec to document why it is NOT mirrored.
- **Fix:** Reworded the comment to "the dead `test.skip(true)` keyboard spec (a no-op in the MA-8 list)" — same intent, no literal `strategy-v2-keyboard` token.
- **Files modified:** `e2e/mobile-drawer-keyboard.spec.ts`
- **Verification:** `grep -c strategy-v2-keyboard` now 0; all other Task 1 greps still pass.
- **Committed in:** `403fbcc6` (Task 1 commit — reworded before staging).

**Total deviations:** 1 auto-fixed (Rule 3 blocking — a grep-acceptance conflict in a doc comment). No code-behaviour change.

## Threat-model coverage

- **T-45-04 (FLOW-01 dual-wiring / verification integrity, `mitigate`):** addressed — both wiring places closed (ci.yml MA-8 + `HAS_SEED_ENV`), every assertion gated behind a fail-loud visible anchor, and proven-execution recorded as the explicit post-push human-verify item.
- **T-45-05 (Playwright trace info-disclosure, `accept`):** unchanged — the new spec runs in the same seed-gated step already covered by the `ci.yml` upload-skip gate; no new exposure, no ci.yml change to that gate.

## Known Stubs

None. The spec asserts real DOM behaviour against the Plan 45-01 implementation; no placeholder data, no mock surfaces, no `test.skip(true)` no-op.

## Issues Encountered

None beyond the single auto-fixed doc-comment grep conflict above.

## User Setup Required

None. The spec READS the existing CI seed env (`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` via `vars.E2E_TEST_DB_CONFIGURED`); it adds no new secret.

## Next Phase Readiness

- NAV-03 is now both implemented (45-01) and proven (45-03, pending the first CI run's passed-not-skipped confirmation).
- Phase 46 (per-surface reflow) can reuse the same `assertNoReflow`/`assertTargetSizes` + seeded-auth pattern for other routes.
- No blockers.

## Self-Check: PASSED

- `e2e/mobile-drawer-keyboard.spec.ts` exists on disk (213 lines).
- `.github/workflows/ci.yml` contains the spec exactly once at line 1262 (MA-8 list).
- Both task commits exist in git history: `403fbcc6` (test), `e2ad904f` (ci).
- `.planning/` is gitignored (local-only per the sequential-execution contract) — this SUMMARY + STATE + ROADMAP are NOT version-controlled; only the `e2e/**` + `ci.yml` code commits land.

---
*Phase: 45-navigation-shell-completion*
*Completed: 2026-06-27*
