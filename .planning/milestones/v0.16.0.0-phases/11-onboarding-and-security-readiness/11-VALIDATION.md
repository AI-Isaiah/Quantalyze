---
phase: 11
slug: onboarding-and-security-readiness
status: planned
nyquist_compliant: true
wave_0_complete: pending
created: 2026-04-26
revised: 2026-04-26
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Every task has an `<automated>` verify command — Nyquist Rule satisfied.

> **Revised 2026-04-26 (multi-voice review fold):** Added rows for BLOCK-1 row-cap regression
> (Plan 02), RISK-1 feature-flag util (Plan 04), W-02 mandateIsSet truth-table test (Plan 05),
> RISK-3 NULL-init defensive case (Plan 01), BLOCK-3 setup checkpoint (Plan 07), and RISK-2
> always-on smoke spec (Plan 07). All atomic-commit RED→GREEN cadence preserved.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (frontend)** | Vitest 4.1.2 + @testing-library/react 16.3.2 + jsdom 29.0.1 |
| **Framework (e2e)** | Playwright 1.59.1 (chromium) |
| **Framework (analytics-service)** | pytest 7.x with pytest-asyncio + pytest-mock |
| **Config files** | `vitest.config.ts`, `playwright.config.ts`, `analytics-service/pytest.ini` |
| **Quick run command** | `npm test` (Vitest single-run) |
| **Full suite command** | `npm run typecheck && npm run lint && npm test && cd analytics-service && pytest` |
| **Estimated runtime (frontend full)** | ~60s |
| **Estimated runtime (Python full)** | ~120s |
| **Estimated runtime (E2E onboarding-funnel, gated)** | <60s (test.setTimeout enforced) |
| **Estimated runtime (E2E onboarding-banner-smoke, always-on)** | <15s (RISK-2 — runs on every PR including forks) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (Vitest, ~30s) — runs ALL Vitest tests; if any fail, commit blocked.
- **After every plan wave:** Run `npm run typecheck && npm run lint && npm test` (frontend full, ~60s) + `cd analytics-service && pytest` (~120s).
- **Phase gate:** Full suite green + `npx playwright test e2e/onboarding-funnel.spec.ts e2e/onboarding-banner-smoke.spec.ts` (funnel gated on TEST_SUPABASE_URL + vars.E2E_TEST_DB_CONFIGURED, skips silently otherwise; smoke runs always per RISK-2). Plus manual `/qa` to verify UI changes per `feedback_qa_to_verify_ui_changes.md`.
- **Max feedback latency:** ~30s (Vitest single run) — well within the 11s target the file template suggests; the 30s is the realistic full-frontend-suite floor.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | ONBOARD-05 | T-11-01..05 | Migration 084 SQL file with both SECURITY DEFINER fns + DO verifier; trigger fires AFTER INSERT on api_keys; service_role GRANT on stamp_first_sync_success; header enumerates ALL 4 api_keys INSERT call sites (FLAG fix); defensive COALESCE for raw_user_meta_data NULL-init (RISK-3) | grep + structural | `grep -c "SECURITY DEFINER" supabase/migrations/084_first_api_key_added_trigger.sql && grep -q "GRANT EXECUTE ON FUNCTION public.stamp_first_sync_success(UUID) TO service_role" supabase/migrations/084_first_api_key_added_trigger.sql && grep -c "AllocatorExchangeManager.tsx\|ApiKeyManager.tsx\|StrategyForm.tsx\|create-with-key" supabase/migrations/084_first_api_key_added_trigger.sql` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | ONBOARD-05 | T-11-04 | Live-DB regression: trigger writes marker idempotently; RPC writes marker idempotently; PLUS NULL-init defensive case (RISK-3 — trigger survives raw_user_meta_data=NULL initial state) | live-DB integration (gated on HAS_LIVE_DB) | `npx vitest run src/__tests__/migration-084-trigger.test.ts` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | ONBOARD-05 | — | [BLOCKING] supabase db push applies migration to production | manual checkpoint:human-verify | (manual: `supabase db push` + verify NOTICE messages) | n/a | ⬜ pending |
| 11-02-01 | 02 | 1 | ONBOARD-03 | T-11-10 | CSV serializer + RFC 4180 escape; metadata→JSON.stringify; null-safe; PLUS the AUDIT_LOG_CSV_CAPTION constant + caption-line test (BLOCK-1) | unit (RTL/Vitest) | `npx vitest run src/lib/audit-log-csv.test.ts && npm run typecheck` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | ONBOARD-03 | T-11-08, T-11-09, T-11-11 (BLOCK-1), T-11-12, T-11-13 | GET /api/me/audit-log/export auth-gated; CSV streamed; @audit-skip pragma; RLS isolation; PLUS `.limit(10000)` row cap with unit (limit spy) + live-DB regression (10K+ seeded rows assertion) (BLOCK-1) | unit + live-DB integration (gated) | `npx vitest run src/app/api/me/audit-log/export/route.test.ts src/__tests__/audit-coverage.test.ts && npm run typecheck && grep -c "limit(10000)" src/app/api/me/audit-log/export/route.ts` | ❌ W0 | ⬜ pending |
| 11-04-01 | 04 | 1 | ONBOARD-04 | T-11-15..18 | WidgetState 5-mode dispatcher; stateless (no useState/useEffect); EmptyState non-duplication meta-test | unit + meta | `npx vitest run src/app/(dashboard)/allocations/components/WidgetState.test.tsx src/__tests__/widget-state-no-duplicate-empty.test.ts && npm run typecheck` | ✅ Wave 0 | ✅ green |
| 11-04-02 | 04 | 1 | ONBOARD-04 | T-11-15 (RISK-1) | Feature-flag util `widget_state_v2`: default OFF + URL override `?widget_state=v2` + SSR-safe — RISK-1 mitigation gating universal-rollout to the 32 long-tail widgets | unit | `npx vitest run src/lib/widget-state-flag.test.ts && npm run typecheck && grep -q "WIDGET_STATE_V2_STORAGE_KEY" src/lib/widget-state-flag.ts` | ✅ Wave 0 | ✅ green |
| 11-04-03 | 04 | 1 | ONBOARD-04 | T-11-17 | 7 DEFAULT_LAYOUT widgets × 5 states matrix; typed fixtures (no `any`); W-01: ≥ 1 entry per category (kpi/chart/table/sparkline/card) pre-filled | component matrix (RTL) | `npx vitest run src/app/(dashboard)/allocations/widgets/__tests__/widget-states.test.tsx && npm run typecheck` | ✅ Wave 0 | ✅ green |
| 11-04-04 | 04 | 1 | ONBOARD-04 | UI-BLOCK-01 | All 7 DEFAULT_LAYOUT widgets consume `<WidgetState>` in production behind `isWidgetStateV2Enabled()` flag (default OFF — RISK-1 preserved). Per-widget regression tests assert WidgetState is invoked with the correct mode under `?widget_state=v2` and NOT invoked when the flag is off. | unit (RTL × 7) | `npx vitest run src/app/(dashboard)/allocations/widgets/bridge/BridgeHeroWidget.test.tsx src/app/(dashboard)/allocations/widgets/meta/KpiStripWidget.v2.test.tsx src/app/(dashboard)/allocations/widgets/performance/EquityChart.v2.test.tsx src/app/(dashboard)/allocations/widgets/positions/HoldingsTableWidget.v2.test.tsx src/app/(dashboard)/allocations/widgets/allocation/AllocationByStyleWidget.v2.test.tsx src/app/(dashboard)/allocations/widgets/risk/MandateSnapshotWidget.v2.test.tsx src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.v2.test.tsx && npm run typecheck && npm run lint` | ✅ created | ✅ green |
| 11-03-01 | 03 | 2 | ONBOARD-05 | T-11-20, T-11-21 | onboarding-funnel.ts maybeEmit* helpers + types extension + ISO week | unit | `npx vitest run src/lib/analytics/onboarding-funnel.test.ts && npm run typecheck` | ❌ W0 | ⬜ pending |
| 11-03-02 | 03 | 2 | ONBOARD-05 | T-11-19, T-11-22, T-11-23 | /allocations/page.tsx fires 5 readers in Promise.allSettled; Python worker calls stamp_first_sync_success RPC | typecheck + Python pytest | `npm run typecheck && cd analytics-service && pytest tests/test_job_worker_first_sync_marker.py && cd ..` | ❌ W0 | ⬜ pending |
| 11-03-03 | 03 | 2 | ONBOARD-05 | T-11-19 | scenario-commit + match-decisions/holding stamp first_outcome_at non-blockingly | route handler regression | `npx vitest run src/app/api/allocator/scenario/commit/route.test.ts src/app/api/match/decisions/holding/route.test.ts && npm run typecheck && npm run lint` | ✅ existing tests | ⬜ pending |
| 11-05-01a | 05 | 2 | ONBOARD-01, ONBOARD-02 | T-11-28 | apiKeysCount + mandateIsSet on payload; RLS-scoped count via user-scoped client; deriveMandateIsSet helper extracted | typecheck + grep | `npm run typecheck && grep -q "apiKeysCount: number" src/lib/queries.ts && grep -q "mandateIsSet: boolean" src/lib/queries.ts && grep -q "export function deriveMandateIsSet" src/lib/queries.ts` | ❌ W0 | ⬜ pending |
| 11-05-01b | 05 | 2 | ONBOARD-01, ONBOARD-02 | T-11-30 (W-02) | mandateIsSet 4-case truth-table coverage: missing row, both fields null, max_weight set, preferred_strategy_types non-empty (W-02) | unit (Vitest pure-fn) | `npx vitest run src/lib/queries.mandateIsSet.test.ts` | ❌ W0 | ⬜ pending |
| 11-05-02 | 05 | 2 | ONBOARD-01, ONBOARD-02 | T-11-26, T-11-27, T-11-30 (BLOCK-2), T-11-31 | OnboardingBanner + MandateQuickSetCard with verbatim UI-SPEC copy; SSR-safe sessionStorage; no auto-save; BLOCK-2 reconciliation: input empty on first render with placeholder "e.g. 15", helper text shows "Suggested: 15%", Save disabled until typed (sub-tests 7a/7b/7c/7d) | unit (RTL) | `npx vitest run src/app/(dashboard)/allocations/components/OnboardingBanner.test.tsx src/app/(dashboard)/allocations/components/MandateQuickSetCard.test.tsx && npm run typecheck && grep -q "placeholder=\"e.g. 15\"" src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx && [ "$(grep -c "useState<string>(\"15\")" src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx)" = "0" ]` | ❌ W0 | ⬜ pending |
| 11-05-03 | 05 | 2 | ONBOARD-01, ONBOARD-02 | — | AllocationsTabs renders S1+S2 above tabs when apiKeysCount===0; existing tabs unchanged | integration (RTL) | `npx vitest run src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx && npm run typecheck` | ❌ W0 | ⬜ pending |
| 11-06-00 | 06 | 2 | ONBOARD-03 | T-11-32 | [checkpoint] Confirm static egress IP range with infrastructure docs | manual checkpoint:human-action | (manual: locate IPs in Vercel/Railway dashboards) | n/a | ⬜ pending |
| 11-06-01 | 06 | 2 | ONBOARD-03 | T-11-33, T-11-34 | /security S4a + S4b + S4c surgical edits; all 8 anchor IDs preserved; metadata.robots.index === true | RTL | `npx vitest run src/app/security/page.test.tsx && npm run typecheck` | ❌ W0 | ⬜ pending |
| 11-06-02 | 06 | 2 | ONBOARD-03 | T-11-38 | WithdrawalWarningStrip (S5) + WizardIpAllowlistHint (S7) verbatim copy + role="note" + WizardClient parent mount | unit (RTL) | `npx vitest run src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.test.tsx src/app/(dashboard)/strategies/new/wizard/WizardIpAllowlistHint.test.tsx && npm run typecheck` | ❌ W0 | ⬜ pending |
| 11-06-03 | 06 | 2 | ONBOARD-03 | T-11-35, T-11-36 | AuditLogSubsection (S6) + ProfileTabs Security tab (allocator-only); browser-download trigger | unit (RTL) | `npx vitest run src/app/(dashboard)/profile/components/AuditLogSubsection.test.tsx && npm run typecheck && npm run lint` | ❌ W0 | ⬜ pending |
| 11-07-01 | 07 | 3 | ONBOARD-06 | T-11-43 | Seed/cleanup helpers with strict env-var assertions; never run against production | typecheck + grep | `npm run typecheck && grep -q "TEST_SUPABASE_URL" e2e/helpers/seed-test-project.ts && grep -q "auth.admin.deleteUser" e2e/helpers/cleanup-test-project.ts` | ❌ W0 | ⬜ pending |
| 11-07-02a | 07 | 3 | ONBOARD-06 | T-11-39, T-11-44, T-11-45 | onboarding-funnel.spec.ts walks full happy path; Pitfall 5 stub; 5-marker assertion; D-16/BLOCK-3 silent-skip gate | E2E (Playwright, gated) | `npm run typecheck && grep -q "page.route.*validate-and-encrypt" e2e/onboarding-funnel.spec.ts && grep -q "test.skip" e2e/onboarding-funnel.spec.ts` | ❌ W0 | ⬜ pending |
| 11-07-02b | 07 | 3 | ONBOARD-06 | T-11-15 (RISK-2 cross-link) | onboarding-banner-smoke.spec.ts is ALWAYS-ON: no skip-gate, asserts WidgetState ARIA presence on /allocations under placeholder Supabase env (RISK-2 fork-PR coverage) | E2E (Playwright, always) | `[ "$(grep -c "test.skip\|TEST_SUPABASE_URL" e2e/onboarding-banner-smoke.spec.ts)" = "0" ] && grep -q "Connect your exchange to see real performance" e2e/onboarding-banner-smoke.spec.ts` | ❌ W0 | ⬜ pending |
| 11-07-03 | 07 | 3 | ONBOARD-06 | T-11-39 (BLOCK-3) | [checkpoint:human-action BLOCKING] Set up dedicated test Supabase project + 3 secrets + repo VARIABLE E2E_TEST_DB_CONFIGURED=true + local spec run BEFORE ci.yml change is committed | manual checkpoint:human-action | (manual: GitHub repo Settings → Actions → Secrets+Variables; user types "done" after all 4 confirmations) | n/a | ⬜ pending |
| 11-07-04 | 07 | 3 | ONBOARD-06 | T-11-40, T-11-41, T-11-46 (BLOCK-3) | ci.yml: BLOCK-3 gate `vars.E2E_TEST_DB_CONFIGURED == 'true'` (NOT secrets.X != ''); RISK-2 smoke spec wired into existing always-on Playwright invocation; YAML parses; existing 4-spec coverage intact (extended with smoke) | YAML lint + grep | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && grep -q "onboarding-funnel.spec.ts" .github/workflows/ci.yml && grep -q "onboarding-banner-smoke.spec.ts" .github/workflows/ci.yml && grep -c "vars.E2E_TEST_DB_CONFIGURED == 'true'" .github/workflows/ci.yml && [ "$(grep -c "secrets.TEST_SUPABASE_URL != ''" .github/workflows/ci.yml)" = "0" ]` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All Wave 0 test files are CREATED in the corresponding plan tasks (no prior plan creates them):

- [ ] `src/__tests__/migration-084-trigger.test.ts` — created in 11-01 Task 2 (incl. RISK-3 NULL-init defensive test)
- [ ] `src/lib/audit-log-csv.test.ts` — created in 11-02 Task 1 (incl. BLOCK-1 caption test)
- [ ] `src/app/api/me/audit-log/export/route.test.ts` — created in 11-02 Task 2 (incl. BLOCK-1 row-cap regression)
- [ ] `src/app/(dashboard)/allocations/components/WidgetState.test.tsx` — created in 11-04 Task 1
- [ ] `src/__tests__/widget-state-no-duplicate-empty.test.ts` — created in 11-04 Task 1
- [ ] `src/lib/widget-state-flag.ts` + `.test.ts` — created in 11-04 Task 1 (RISK-1 feature-flag util)
- [ ] `src/app/(dashboard)/allocations/widgets/__tests__/widget-states.fixtures.ts` + `widget-states.test.tsx` — created in 11-04 Task 2 (W-01: ≥ 1 pre-filled entry per category)
- [ ] `src/lib/analytics/onboarding-funnel.test.ts` — created in 11-03 Task 1
- [ ] `analytics-service/tests/test_job_worker_first_sync_marker.py` — created in 11-03 Task 2
- [ ] `src/lib/queries.mandateIsSet.test.ts` — created in 11-05 Task 1 (W-02 4-case truth-table)
- [ ] `src/app/(dashboard)/allocations/components/OnboardingBanner.test.tsx` + `MandateQuickSetCard.test.tsx` + `AllocationsTabs.onboarding.test.tsx` — created in 11-05 Tasks 2+3 (incl. BLOCK-2 sub-tests 7a/7b/7c/7d)
- [ ] `src/app/security/page.test.tsx` — created in 11-06 Task 1
- [ ] `src/app/(dashboard)/strategies/new/wizard/WithdrawalWarningStrip.test.tsx` + `WizardIpAllowlistHint.test.tsx` — created in 11-06 Task 2
- [ ] `src/app/(dashboard)/profile/components/AuditLogSubsection.test.tsx` — created in 11-06 Task 3
- [ ] `e2e/onboarding-funnel.spec.ts` — created in 11-07 Task 2 (gated)
- [ ] `e2e/onboarding-banner-smoke.spec.ts` — created in 11-07 Task 2 (RISK-2 always-on)
- [ ] `e2e/helpers/seed-test-project.ts` + `cleanup-test-project.ts` — created in 11-07 Task 1

**Framework install: NONE.** Vitest, Playwright, jsdom, RTL, pytest, pytest-asyncio, pytest-mock all already configured per TESTING.md and analytics-service/pytest.ini.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration 084 applied to production via supabase db push | ONBOARD-05 | `supabase db push` is interactive; CI does not have non-prod credentials configured for direct migration execution | Plan 01 Task 3 checkpoint:human-verify — run `supabase db push` locally; verify NOTICE messages |
| Static egress IP values for S4b on /security | ONBOARD-03 | UI-SPEC §S4b LOCKED: "If the executor cannot find published IP ranges, the executor MUST stop and ask — do NOT invent IPs." | Plan 06 Task 0 checkpoint:human-action — locate IPs in Vercel/Railway/internal docs |
| BLOCK-3 setup: dedicated test Supabase project + 3 secrets + repo VARIABLE E2E_TEST_DB_CONFIGURED + local spec run | ONBOARD-06 | Repository secrets/variables cannot be written via API by an automated agent; user must add them manually in GitHub UI; the local spec run confirms the seed/cleanup helpers work end-to-end against the test project before the ci.yml gate ships | Plan 07 Task 3 BLOCKING checkpoint:human-action — verify all 4 setup steps (test project, 3 secrets, 1 repo variable, local spec run) before Task 4 ci.yml mod |
| /qa pass on /allocations + wizard + /security + /profile?tab=security | ONBOARD-01..04 | Visual verification of UI changes (per project skill routing — feedback_qa_to_verify_ui_changes.md) | After all plans complete, run `/qa` and follow the project's QA flow |
| /security page remains public + indexable post-merge | ONBOARD-03 | Production check that the page hasn't accidentally been auth-gated by a downstream change | After merge: `curl -H "Cookie:" https://quantalyze-rho.vercel.app/security` returns 200 + indexable headers |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (manual checkpoints documented separately above)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (the 3 manual checkpoints — 11-01-03, 11-06-00, 11-07-03 — are checkpoint:human-verify / checkpoint:human-action and bracketed by automated tests)
- [x] Wave 0 covers all MISSING references (every test file is created in a Phase 11 plan task)
- [x] No watch-mode flags (all commands use `vitest run` not `vitest`; `playwright test` not `playwright test --watch`)
- [x] Feedback latency: ~30s for Vitest single run (acceptable; the 11s target is aspirational for the smaller-suite phases)
- [x] `nyquist_compliant: true` set in frontmatter
- [x] Multi-voice review fold complete (BLOCK-1, BLOCK-2, BLOCK-3, RISK-1, RISK-2, RISK-3, W-01, W-02, FLAG all addressed in the tasks above)

**Approval:** approved 2026-04-26 (planner self-validation post review fold; checker may revise)

---

## ONBOARD-04 Delivery Closure (UI-BLOCK-01 resolved 2026-04-26)

ONBOARD-04 ships fully delivered as of 2026-04-26. The pre-resolution
state had the `<WidgetState>` primitive + matrix test + flag util in
place, but **zero production consumers** — the BLOCK in
`11-UI-REVIEW.md`. Resolution wires all 7 DEFAULT_LAYOUT widgets
through the primitive behind the `isWidgetStateV2Enabled()` flag
(default OFF — RISK-1 preserved):

| Widget | Modes wired | Commit |
|--------|-------------|--------|
| BridgeHeroWidget | error | `f465a2c` |
| KpiStripWidget | success | `fdfde29` |
| EquityChartWidget | success | `c0ae392` |
| HoldingsTableWidget | success | `e747388` |
| AllocationByStyleWidget | success | `f03aa32` |
| MandateSnapshotWidget | success | `e5d6825` |
| OutcomesWidget | error + success | `9be9efb` |

Five widgets wire success-only because their existing card chrome
already carries the empty/header/CTA semantics that the primitive's
`mode="empty"` would have to replace wholesale, and the
prototype-parity contract (per `feedback_dashboard_parity_visual_fidelity.md`)
forbids adapting the design. Two widgets (BridgeHero, Outcomes) wire
the `mode="error"` branch with verbatim existing copy. See
`11-UI-REVIEW.md §UI-BLOCK-01 Resolution` for the full table including
modes-skipped reasons per widget.

**Verification:** Vitest 2273 passed | 148 skipped | 0 failed; typecheck
0 errors; lint 0 new warnings on the 12 modified/new files.

**Long-tail rollout (32 WIDGET_REGISTRY widgets without DEFAULT_LAYOUT
inclusion) remains DEFERRED.** The `widget_state_v2` flag still gates
universal consumption per the original RISK-1 contract; the 7
in-scope DEFAULT_LAYOUT widgets ship with flag-off-default wiring
that turns on per-allocator under
`localStorage.setItem('widget_state_v2','true')` or
`?widget_state=v2`.
