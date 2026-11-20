---
phase: "219"
slug: "accountemail-the-signed-in-account-shows-its-email-and-can-c"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-19"
---

# Phase 219 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 219-RESEARCH.md "Validation Architecture", bound to the verify blocks of 219-01/02/03-PLAN.md.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom for components); SQL gates on the pg-lane (`scripts/pg-lane/run.sh`) and the local-stack lane (`scripts/local-stack/run.sh`); mutation runner (`scripts/mutation-runner/run.mjs`) |
| **Config file** | `vitest.config.ts`; `scripts/mutation-floors.mjs`; each gate's `RED-UNDER-SETUP` header |
| **Quick run command** | `npx vitest run src/components/auth/AccountEmailSection.test.tsx src/app/auth/callback/route.test.ts src/components/auth/ProfileTabs.test.tsx` |
| **Full suite command** | `npm run lint && npm run typecheck && npm test`, plus `node scripts/mutation-runner/run.mjs --file supabase/tests/test_profiles_email_sync.sql` and the linters `node scripts/lint-migration-data-dependence.mjs`, `node scripts/lint-sql-gates.mjs` and `node scripts/lint-app-guc.mjs` |
| **Estimated runtime** | quick run about 30 s; one-gate mutation run a few minutes; local-stack boot several minutes |

---

## Sampling Rate

- **After every task commit:** run the quick run command, plus the linters relevant to the files the task touched.
- **After every plan wave:** run the census vitest list from 219-03 Task 1, `node scripts/mutation-runner/run.mjs --parse-only` and `npm run schema:functions:check`.
- **Before `/gsd-verify-work`:** the full suite is green. CI `sql-mutation` (FULL), `sql-gate-lint` and `sql-tests` are green on the PR head SHA, with the expected check count.
- **Max feedback latency:** the quick run command, under 60 s.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Decision | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|----------|------------|-----------------|-----------|-------------------|-------------|--------|
| 219-01-01 | 01 | 1 | D-06, D-07, D-10, D-11 | T-219-01, T-219-03, T-219-06 | the trigger syncs a changed auth email; DDL applies on a real local-stack replay; the migration lint is clean | SQL gate + lint | `node scripts/lint-migration-data-dependence.mjs && node scripts/mutation-runner/run.mjs --file supabase/tests/test_profiles_email_sync.sql` | ❌ W0 (created by the task) | ⬜ pending |
| 219-01-02 | 01 | 1 | D-06, D-07, D-08 | T-219-01..05 | no write on unchanged email; sanitize GUC skip; fires with no EXECUTE; authenticated cannot write profiles.email; hardening | mutation | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_profiles_email_sync.sql` | ❌ W0 | ⬜ pending |
| 219-02-01 | 02 | 1 | D-01, D-02, D-04, D-11 | T-219-08, T-219-10 | email shown from getUser(); encoded redirect; callback lands on /profile?tab=account | component + route | `npx vitest run src/components/auth/AccountEmailSection.test.tsx src/app/auth/callback/route.test.ts src/components/auth/ProfileTabs.test.tsx` | ❌ W0 (component test) / ✅ (route, tabs) | ⬜ pending |
| 219-02-02 | 02 | 1 | D-02, D-03, D-05 | T-219-10, T-219-11 | every UI-SPEC state; same-address guard; error fallbacks; focus contract | component + typecheck | same vitest list, then `npm run typecheck` | ❌ W0 | ⬜ pending |
| 219-03-01 | 03 | 2 | D-08 | T-219-12, T-219-13 | floors count the new gate; no waiver | vitest census | `npx vitest run src/__tests__/mutation-annotation-parser.test.ts src/__tests__/mutation-runner-floors.test.ts src/__tests__/lint-sql-gates.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/drift-check-scripts.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` | ✅ | ⬜ pending |
| 219-03-02 | 03 | 2 | D-08, D-10 | T-219-13 | snapshot plus ratchet row; only the expected SNAPSHOT_MISSING finding | static + vitest | `npm run schema:functions:check` plus the mechanical baseline-content-drift line checks in the plan | ✅ | ⬜ pending |
| 219-03-03 | 03 | 2 | D-06 | — | re-dump hazard booked with an owner | grep | `grep -c '219-EXTRACTOR-UPDATE-OF' TODOS.md && npx tsx scripts/check-planning-hygiene.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_profiles_email_sync.sql`: annotated, every arm twinned (219-01)
- [ ] `src/components/auth/AccountEmailSection.test.tsx` (219-02 Task 1, written RED first)
- [ ] new cases in `src/app/auth/callback/route.test.ts` and `src/components/auth/ProfileTabs.test.tsx` (219-02)
- [ ] `supabase/migrations/down/20261119120000-rollback.sql` (219-01)

The tasks that need them create them; no framework install is needed.

---

## Manual-Only Verifications

| Behavior | Decision | Why Manual | Test Instructions |
|----------|----------|------------|-------------------|
| A real confirmation fires the trigger (RESEARCH A4) | D-06 | GoTrue behaviour on hosted Supabase cannot be reproduced locally; D-10 forbids hand-applying to TEST | After merge and apply on TEST: change an email from /profile?tab=account, confirm, then read profiles.email against auth.users.email count-only |
| Double-confirm first-click landing (A2) | D-05, D-12 | Depends on a dashboard setting this phase does not change | Observe where the first link click lands, under whichever setting is configured; the pending copy must still be true |
| Redirect allow-list accepts a URL with a query string (A3) | D-04, D-12 | Dashboard configuration | Confirm the link lands on /profile?tab=account rather than the Site URL |
| 254-character address wraps at 375px | UI-SPEC long-text | Visual | Open the Account tab at 375px width; no horizontal scroll |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency under 60 s for the quick run
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
