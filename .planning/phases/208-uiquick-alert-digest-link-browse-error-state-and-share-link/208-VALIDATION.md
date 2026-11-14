---
phase: "208"
slug: "uiquick-alert-digest-link-browse-error-state-and-share-link"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-14"
---

# Phase 208 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `208-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (jsdom) + Testing Library; `renderToStaticMarkup` for server pages |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/app/browse src/lib/email.test.ts src/lib/queries.anon-read-errors.test.ts` and `npx vitest run src/components/strategy/ShareableLink.test.tsx` and `npx vitest run "src/app/api/strategies/[id]/share" src/app/api/allocator/scenario/share` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~20 seconds (quick), several minutes (full) |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the files the task touched
- **After every plan wave:** Run the gate set (`npx vitest run src/__tests__/copy-census.test.ts src/__tests__/display-sign-single-source.test.ts src/__tests__/trim-removed-surfaces.test.tsx src/__tests__/critical-regressions.test.ts "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx"`) + `npm run typecheck`
- **Before `/gsd-verify-work`:** `npm test` and `npm run lint` green, run under Node 22 (the `.nvmrc` pin; under Node 25 two `compute.conventions.test.ts` arms fail on a last-digit float difference unrelated to this phase)
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

Bound by the planner on 2026-11-14. Task ID = `{phase}-{plan}-{task}`. Plans 01, 02 and 05 are wave 1 (no shared file); plan 03 is wave 2 (it edits the same two ShareableLink files as plan 02); plan 04 is wave 3 (the one-off WebKit and D-11 readings on plan 03's final code, split out after plan-checker round 1). Plan 05 (D-16, the share-link host) was added on 2026-11-14 after the founder decision. Multi-file commands carry no `--project` flag because `critical-regressions.test.ts` runs in the node project.

| Task ID | Plan | Wave | Requirement | Behavior | Test Type | Automated Command | Neuter target (RED proof) | Threat Ref | Status |
|---------|------|------|-------------|----------|-----------|-------------------|---------------------------|------------|--------|
| 208-01-01 | 01 | 1 | SC-2a | `getPopulatedCategorySlugs` throws (and captures once) on error; `[]` on empty | unit | `npx vitest run src/lib/queries.anon-read-errors.test.ts` | restore `return []` in error branch (neuter a) | T-208-02, T-208-03 | ⬜ pending |
| 208-01-01 | 01 | 1 | SC-2b | `/browse` empty line vs `role="alert"` error block; no redirect or cards on either | unit | `npx vitest run src/app/browse/page.test.tsx` | map error to empty (b); fallback cards for non-ok (c) | T-208-01 | ⬜ pending |
| 208-01-01 | 01 | 1 | SC-2c | breadcrumb keeps Browse link on failed read | unit | `npx vitest run src/app/browse/breadcrumb-root.test.tsx` | regression pin (unchanged arm) | T-208-01 | ⬜ pending |
| 208-01-02 | 01 | 1 | SC-2b (D-14) | ok read with no known category renders empty | unit | `npx vitest run src/app/browse/page.test.tsx` | delete the D-14 statement (d) | — | ⬜ pending |
| 208-01-02 | 01 | 1 | SC-2 (D-03 retry) | Try again re-runs the read; unseeded `/browse` sweeps pass on the error block | manual one-off (scripted) | dev server on port 3218, then the Try again script and the sweep command exactly as written in `208-01-PLAN.md` Task 2 step 5 (not restated here: its grep pattern contains a pipe) | n/a (live reading; `8 passed` at HEAD) | T-208-05 | ⬜ pending |
| 208-01-03 | 01 | 1 | SC-1 | digest link reads `Open your allocation →`, href `/allocations`, no old label, no `dashboard`, no `/portfolios` | unit | `npx vitest run src/lib/email.test.ts` | restore old label (e) | T-208-04 | ⬜ pending |
| 208-02-01 | 02 | 1 | SC-3a (mint) | the mint catch logs `{ strategyId, err }`, status-only message | component | `npx vitest run src/components/strategy/ShareableLink.test.tsx` | delete the mint `console.warn` (208-02 neuter a) | T-208-06 | ⬜ pending |
| 208-02-01 | 02 | 1 | SC-3b, SC-3c | 404 wording; row live region carries the label | component | same | collapse mapping (b); null region (d) | T-208-07 | ⬜ pending |
| 208-02-02 | 02 | 1 | SC-3b | 401, redirect to `/login` (D-13), 403; other failures keep "try again" | component | same | collapse mapping (b); delete redirect branch (c) | T-208-07, T-208-08 | ⬜ pending |
| 208-02-03 | 02 | 1 | D05-RED (code) | file-level warm-up; explicit `{ timeout: 5000 }` on lazy-panel awaits | component | same (3 quiet runs) | none reproducible locally (stated, not claimed) | — | ⬜ pending |
| 208-03-01 | 03 | 2 | SC-3a (copy), SC-3d, SC-3g | helper catches log without the URL; dialog Copy link copies with no fetch; temp input inside the open dialog; reselect incl. `setSelectionRange` | component | `npx vitest run src/components/strategy/ShareableLink.test.tsx` | mint first (a); drop the clipboard log (b); drop the execCommand log (b2); body host (c); drop `setSelectionRange` (d); null dialog region (e) | T-208-09, T-208-10 | ⬜ pending |
| 208-03-02 | 03 | 2 | SC-3e, SC-3f | published lane shows the URL; published copy stays synchronous; hang ends visibly failed (dialog + factsheet `mintAndCopy`) | component | same + `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.share-affordance.test.tsx"` | restore mint-token gate (f); await before copy (g); remove the bound, both hang arms RED (h) | T-208-11 | ⬜ pending |
| 208-04-01 | 04 | 3 | SC-3h (D-09) | WebKit iPhone 15 reading recorded (selection, published dialog, in-dialog fallback copies) | manual one-off (scripted) | temporary harness on port 3208, deleted in teardown | n/a | T-208-12, T-208-13 | ⬜ pending |
| 208-04-02 | 04 | 3 | D05-RED (reading) | D-05 arm green 3x quiet + 3x under 24 busy loops, after the last test-file edit | component | `npx vitest run src/components/strategy/ShareableLink.test.tsx` (repeated) | none reproducible locally (stated, not claimed) | — | ⬜ pending |
| 208-05-01 | 05 | 1 | SC-4 (D-16) | strategies share link minted on a preview host returns that host; Referer, env and localhost rungs pinned | unit | `npx vitest run "src/app/api/strategies/[id]/share/route.test.ts"` | env-first order restored (208-05 neuter a) | T-208-14, T-208-15 | ⬜ pending |
| 208-05-02 | 05 | 1 | SC-4 (D-16) | scenario share link on the request origin; real wrapper chain 403s a forged or header-less origin and admits the preview host | unit | `npx vitest run src/app/api/allocator/scenario/share/route.test.ts src/app/api/allocator/scenario/share/route.csrf-integration.test.ts` | env-first order restored (a2); `withAuth` gate line removed (calibration b) | T-208-14, T-208-15, T-208-16 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dialog URL field focused and fully selected in WebKit on an iPhone profile | D-09 / 170.6.1-R2-IOS-SELECT | jsdom cannot model iOS focus/selection; the TODO asks for one real-engine check, not a CI gate | Task 208-04-01: temporary harness page, dev server on port 3208, Playwright WebKit iPhone 15; record the reading in SUMMARY/VERIFICATION; tear the harness down and restore `AGENTS.md` from a byte backup |
| `/browse` Try again re-runs the read on a real click | D-03 | dev-server behaviour, measured once by research via router.push | Task 208-01-02: one scripted Chromium click on the error page of a closed-port dev server on port 3218 (in plan 01, because only plan 01's worktree carries the browse fix in wave 1), counting the server's error log lines before and after |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
