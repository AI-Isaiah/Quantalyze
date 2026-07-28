---
phase: 53
slug: per-surface-application-wizard-security-admin-public
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-29
---

# Phase 53 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. **This milestone favors
> FALSIFIABLE structural guards over class-string jsdom tests** (the #551 false-pass lesson: a
> same-element `@container` host passed a class-string jsdom test but froze the grid 1-wide live).
> Full architecture in `53-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 (unit/component, jsdom) + Playwright 1.59 (e2e) |
| **Config file** | `vitest.config.ts` (coverage thresholds: lines 82 / stmts 80 / fns 74 / branches 72), `playwright.config.ts` |
| **Quick run command** | `npx vitest run <path>` (per-file) · `npm run lint` (no-raw-font-px on migrated glob + route-contract guard) |
| **Full suite command** | `npm run test` · `npm run test:e2e` · `npm run test:coverage` (the BLOCKING `frontend-coverage` CI gate) |
| **Estimated runtime** | ~90s unit · e2e per-spec ~1–3 min |

---

## Sampling Rate

- **After every task commit:** `npm run lint` (no-raw-font-px on the migrated glob + route-contract guard) + `npx vitest run <touched file>.test.tsx`
- **After every plan wave (surface):** `npx vitest run` (full unit) + the surface's `npx playwright test e2e/<surface>-axe.spec.ts e2e/reflow-sweep-authed.spec.ts` + `src/__tests__/phase-52-frozen-spine-guards.test.ts` (math islands untouched)
- **Before `/gsd:verify-work`:** full `npm run test` + `npm run test:e2e` + `npm run test:coverage` green
- **Max feedback latency:** ~90s (unit)

---

## Per-Requirement Verification Map

> Per-task rows are filled by the planner; these are the requirement-level proofs from RESEARCH.

| Req | Behavior | Test Type | Automated Command | File |
|-----|----------|-----------|-------------------|------|
| APPLY-02 | wizard review step + inline validation; state machine/autosave/POST unchanged | component + behavioral | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx"` + new review-step test | ⚠️ pin existing first |
| APPLY-02 | wizard zero axe (api + csv + review step) | e2e axe | `npx playwright test e2e/wizard-axe.spec.ts` | ✅ extend |
| APPLY-03 | /security raw `text-[Npx]` migrated; no-raw-font-px error | lint (grep) | `npm run lint` (after glob flips) | ❌ wave |
| APPLY-04 | admin/portfolios fluid-fill 1920 via `DashboardChrome.isWide` | component | `npx vitest run src/components/layout/DashboardChrome.test.tsx` | ✅ flip assertions |
| APPLY-04 | admin `@container` parent/child host; `tabular-nums` preserved | component (structural) | `npx vitest run <admin-table>.test.tsx` | ⚠️ new |
| TYPE-02 | accidental clips fixed w/ recovery; no clip relocated | unit + audit diff | `npx vitest run` + truncation-audit cross-check | ❌ wave |
| TYPE-03 | no horizontal scroll 320→2560 (wizard + /security) | e2e reflow | `npx playwright test e2e/reflow-sweep-authed.spec.ts` | ✅ (admin EXCLUDED — Pitfall 7) |
| STATE-05 | route `loading.tsx`/`error.tsx` render; digest-only; sr-only liveness | component | `npx vitest run src/app/.../{loading,error}.test.tsx` | ⚠️ new |
| STATE-05 | honest degenerate states (no invented data) | component | `npx vitest run` (extend empty branches) | ✅ extend |
| BP-02 | no frozen island RSC-ified; math islands zero-diff | git-delta guard | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` | ✅ exists |
| BP-02 | route-contract guard + PUBLIC_ROUTES green | lint | `npm run lint` | ✅ exists |
| BP-02 | coverage ratchet green | coverage | `npm run test:coverage` | ✅ blocking gate |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] PIN the wizard behavioral guard FIRST — `WizardClient.test.tsx` (transitions/autosave) + `finalize-wizard/route.test.ts` (POST body) + `localStorage.test.ts` (step-enum validation) green BEFORE the migration and still green after the review-step insertion. (No new git-delta guard — Phase 53 deliberately edits WizardClient.)
- [ ] Per-new-`loading.tsx`/`error.tsx` render test (model `strategy/[id]/v2/error.test.tsx`): `role="status"` liveness + dominant-anchor structure + (error) `unstable_retry` invoked + digest-only (never `error.message`).
- [ ] Per-new-`@container` STRUCTURAL test: host + `@`-variants are parent/child (NOT same-element) + `tabular-nums` preserved — falsifiable, not class-string.
- [ ] Wizard review-step test: recap shows ONLY entered values (no fabricated data); each "Edit" returns to the owning step; review NOT `role="alert"`; final CTA verb unchanged.
- [ ] Wizard inline-validation test: blur+submit surfaces the `wizardErrors.ts` string through `Field` (`aria-invalid`+`aria-describedby`); per-field NOT `role="alert"`; envelope stays the summary; submit focuses first invalid field.
- [ ] `DashboardChrome.test.tsx`: admin/portfolios assert `max-w-[1920px]`; retarget the not-widened assertions to a still-narrow route.
- [ ] Per-surface no-clip assertion that the audit's accidental-clip sites carry `title=`/wrap (app-wide no-clip CI guard is Phase 54; a scoped check is cheap now).
- [ ] Framework install: none — Vitest + Playwright already configured.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin ultra-wide (≥1920) responsiveness | APPLY-04 | The allocator seed stamps `role='allocator'`; admin redirects non-admins → e2e false-green risk (Pitfall 7). Admin-seeded e2e row is a Phase-54 concern. | Prove via component Vitest (`DashboardChrome` widened + admin-table `@container`) + the DESIGN.md-conformance check this phase. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
