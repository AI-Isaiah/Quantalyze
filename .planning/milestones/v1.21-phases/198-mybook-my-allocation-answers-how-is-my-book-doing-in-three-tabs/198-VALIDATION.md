---
phase: "198"
slug: "mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-08"
---

# Phase 198 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^5 (jsdom, colocated) + Playwright for e2e |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npx vitest run "src/app/(dashboard)/allocations"` |
| **Full suite command** | `npm test` + `npm run typecheck` + `npm run lint` |
| **Estimated runtime** | ~120 seconds (quick), several minutes (full) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run "src/app/(dashboard)/allocations"` + `npx tsc --noEmit`
- **After every plan wave:** Run `npx vitest run "src/app/(dashboard)/allocations" src/components/layout src/__tests__` + `npm run lint`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 198-01-T1 | 01 | 1 | ROUTE-07 | T-198-01, T-198-02, T-198-SC | Sharpe withheld under the 194 D-15 gate; no fabricated figure; D-06 labels distinct | unit, component, census | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-01-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/components/GlancePanel.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.failing-key.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.ready-empty-book.test.tsx" src/__tests__/figure-gate-census.test.ts src/__tests__/display-sign-single-source.test.ts && test -z "$(grep -a -rlF 'YTD TWR' src/app/factsheet)"` | ❌ W0: GlancePanel.test.tsx (created RED-first by this task or an earlier plan of this phase); ❌ until 194.1 merges: figure-gate-census.test.ts (task precondition) | ⬜ pending |
| 198-01-T2 | 01 | 1 | ROUTE-07 | T-198-01, T-198-02, T-198-SC | One figures module feeds glance and Scenario, so the two cannot diverge | unit, component, census, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/lib/book-figures.test.ts" "src/app/(dashboard)/allocations/components/GlancePanel.scenario-parity.test.tsx" "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx" "src/app/(dashboard)/allocations/components/KpiStrip.test.tsx" "src/app/(dashboard)/allocations/components/KpiStrip.scenario.test.tsx"` (+2 more gates) | ❌ W0: book-figures.test.ts, GlancePanel.scenario-parity.test.tsx (created RED-first by this task or an earlier plan of this phase); ❌ until 194.1 merges: figure-gate-census.test.ts (task precondition) | ⬜ pending |
| 198-02-T1 | 02 | 1 | ROUTE-08, LEAN-06 | T-198-03, T-198-SC | Cash set equals the Python STABLECOINS literal member for member | unit | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-02-PLAN.md && npx vitest run src/lib/closed-sets.cash-symbols.test.ts src/lib/closed-sets.test.ts "src/app/(dashboard)/compare/lib/holding-compare-adapter.test.ts"` | ❌ W0: closed-sets.cash-symbols.test.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-02-T2 | 02 | 1 | ROUTE-08, LEAN-06 | T-198-03, T-198-SC | Strict dust boundary; unpriced and untrusted-key rows never hidden | unit, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/lib/dust.test.ts" src/lib/closed-sets.cash-symbols.test.ts` (+1 more gate) | ❌ W0: dust.test.ts, closed-sets.cash-symbols.test.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-03-T1 | 03 | 1 | ROUTE-07 | T-198-04, T-198-05, T-198-06, T-198-SC | Gaps are owner-only and per key; one key's problem never names another | unit | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-03-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts"` | ❌ W0: key-data-gaps.test.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-03-T2 | 03 | 1 | ROUTE-07 | T-198-04, T-198-05, T-198-06, T-198-SC | Both payload arms carry gaps through the owner's key filter | unit, census, typecheck+lint | `npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts "src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts"` (+2 more gates) | ❌ W0: key-data-gaps.test.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-04-T1 | 04 | 1 | LEAN-06 | T-198-07, T-198-SC | Closed tab map; an unknown tab falls back to Overview and logs | component | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-04-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx"` | ✅ | ⬜ pending |
| 198-04-T2 | 04 | 1 | LEAN-06 | T-198-07, T-198-SC | Nav and route guards stay green after the tab change | unit, component, census, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.connect-key-predicate.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.tabstrip-scroll.test.ts" "src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx"` (+3 more gates) | ✅ | ⬜ pending |
| 198-05-T1 | 05 | 1 | ROUTE-06 | T-198-08, T-198-09, T-198-10, T-198-11, T-198-SC | Two-route dispatch, server-side validation, idempotency key | unit, component | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-05-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/lib/add-allocation.test.ts" "src/app/(dashboard)/allocations/components/AllocateDialog.test.tsx" "src/app/(dashboard)/allocations/components/AllocateDialog.retry-prop.test.tsx" "src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx" "src/app/(dashboard)/allocations/components/OutcomeForm.test.tsx" src/__tests__/contracts/check-zod-db-check-parity.test.ts` | ❌ W0: add-allocation.test.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-05-T2 | 05 | 1 | ROUTE-06 | T-198-08, T-198-09, T-198-10, T-198-11, T-198-SC | Picker lists only strategies the server returned | unit, component, census | `npx vitest run "src/app/(dashboard)/allocations/components/AddAllocationFlow.test.tsx" src/__tests__/display-sign-single-source.test.ts src/__tests__/figure-gate-census.test.ts` | ❌ W0: AddAllocationFlow.test.tsx (created RED-first by this task or an earlier plan of this phase); ❌ until 194.1 merges: figure-gate-census.test.ts (task precondition) | ⬜ pending |
| 198-05-T3 | 05 | 1 | ROUTE-06 | T-198-08, T-198-09, T-198-10, T-198-11, T-198-SC | Write re-validated on the server; retry cannot double-allocate | unit, component, census, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/components/AddAllocationFlow.test.tsx" "src/app/(dashboard)/allocations/lib/add-allocation.test.ts"` (+2 more gates) | ❌ W0: AddAllocationFlow.test.tsx, add-allocation.test.ts (created RED-first by this task or an earlier plan of this phase); ❌ until 194.1 merges: figure-gate-census.test.ts (task precondition) | ⬜ pending |
| 198-06-T1 | 06 | 2 | LEAN-06, ROUTE-07 | T-198-12, T-198-SC | Risk figures render only under the one history gate | component | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-06-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx" "src/app/(dashboard)/allocations/RiskTabPanel.book-series.test.tsx"` | ✅ | ⬜ pending |
| 198-06-T2 | 06 | 2 | LEAN-06, ROUTE-07 | T-198-12, T-198-SC | Mandate moves read-only; nothing deleted silently | component, unit, census, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/MandateTabPanel.test.tsx" "src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx"` (+2 more gates) | ✅ | ⬜ pending |
| 198-07-T1 | 07 | 2 | ROUTE-08, LEAN-06 | T-198-13, T-198-SC | Cash out of exposure; no fabricated zero | unit | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-07-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/lib/exposure-snapshot.test.ts" src/lib/portfolio-exposure.test.ts` | ✅ | ⬜ pending |
| 198-07-T2 | 07 | 2 | ROUTE-08, LEAN-06 | T-198-13, T-198-SC | Cash cell reads a dash when nothing was read; no position re-listed | unit, component, census, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.test.tsx" "src/app/(dashboard)/allocations/HoldingsTabPanel.exposure.test.tsx" "src/app/(dashboard)/allocations/HoldingsTabPanel.exposure-agreement.test.tsx" src/__tests__/display-sign-single-source.test.ts` (+2 more gates) | ❌ W0: closed-sets.cash-symbols.test.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-08-T1 | 08 | 2 | ROUTE-06 | T-198-14, T-198-15, T-198-16, T-198-SC | Header opens the allocator flow, never the manager wizard | component | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-08-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx"` | ✅ | ⬜ pending |
| 198-08-T2 | 08 | 2 | ROUTE-06 | T-198-14, T-198-15, T-198-16, T-198-SC | ?add= resolved against the server list, stripped on open, bad ids logged | component, unit, census | `npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.add-param.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx"` (+2 more gates) | ❌ W0: AllocationsTabs.add-param.test.tsx (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-08-T3 | 08 | 2 | ROUTE-06 | T-198-14, T-198-15, T-198-16, T-198-SC | New e2e listed in CI and skipped without seed env | e2e (listed), typecheck+lint | `npx playwright test e2e/allocations-add.spec.ts e2e/wizard-resume.spec.ts e2e/reflow-sweep-authed.spec.ts e2e/no-clip-sweep.spec.ts --list` (+1 more gate) | ❌ W0: allocations-add.spec.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-09-T1 | 09 | 3 | ROUTE-07 | T-198-17, T-198-18, T-198-SC | Every named key labelled through apiKeyLabelById | unit, component, census | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-09-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx" src/__tests__/display-sign-single-source.test.ts src/__tests__/figure-gate-census.test.ts` | ❌ W0: MissingDataMessage.test.tsx (created RED-first by this task or an earlier plan of this phase); ❌ until 194.1 merges: figure-gate-census.test.ts (task precondition) | ⬜ pending |
| 198-09-T2 | 09 | 3 | ROUTE-07 | T-198-17, T-198-18, T-198-SC | RED step: tests expect the missing-data section | component, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.ready-empty-book.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.warmup.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.connect-key-predicate.test.tsx" "src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx"; test $? -ne 0` (+1 more gate) | ✅ | ⬜ pending |
| 198-09-T3 | 09 | 3 | ROUTE-07 | T-198-17, T-198-18, T-198-SC | Exit note does not repeat the message; a key's gap stays its own | component, unit, census, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/AllocationDashboardV2.failing-key.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.ready-empty-book.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.warmup.test.tsx" "src/app/(dashboard)/allocations/AllocationsTabs.connect-key-predicate.test.tsx" "src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx"` (+2 more gates) | ❌ until 194.1 merges: figure-gate-census.test.ts (task precondition) | ⬜ pending |
| 198-10-T1 | 10 | 4 | ROUTE-07 | T-198-19, T-198-SC | Panel removed with its fallbacks preserved | component | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-10-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx" "src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx"` | ❌ W0: MissingDataMessage.test.tsx (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-10-T2 | 10 | 4 | ROUTE-07 | T-198-19, T-198-SC | Scenario class-parity and fail-closed cases preserved | component, unit, census, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" "src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx"` (+2 more gates) | ❌ W0: MissingDataMessage.test.tsx (created RED-first by this task or an earlier plan of this phase); ❌ until 194.1 merges: figure-gate-census.test.ts (task precondition) | ⬜ pending |
| 198-11-T1 | 11 | 3 | LEAN-06, ROUTE-07, ROUTE-08 | T-198-20, T-198-SC | Retired Outcomes content still renders and is labelled | component | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-11-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/HoldingsTabPanel.test.tsx" "src/app/(dashboard)/allocations/HoldingsTabPanel.exposure.test.tsx" "src/app/(dashboard)/allocations/HoldingsTabPanel.key-read-notes.test.tsx" "src/app/(dashboard)/allocations/HoldingsTabPanel.exposure-agreement.test.tsx"` | ✅ | ⬜ pending |
| 198-11-T2 | 11 | 3 | LEAN-06, ROUTE-07, ROUTE-08 | T-198-20, T-198-SC | Header and glance print one Book equity string | unit, component | `npx vitest run "src/app/(dashboard)/allocations/HoldingsTabPanel.positions-header.test.tsx" "src/app/(dashboard)/allocations/components/GlancePanel.test.tsx" "src/app/(dashboard)/allocations/lib/book-figures.test.ts"` | ❌ W0: HoldingsTabPanel.positions-header.test.tsx, GlancePanel.test.tsx, book-figures.test.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-11-T3 | 11 | 3 | LEAN-06, ROUTE-07, ROUTE-08 | T-198-20, T-198-SC | Hiding dust never moves a total; unpriced and untrusted rows never hidden | unit, component, census, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/HoldingsTabPanel.dust.test.tsx" "src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx" "src/app/(dashboard)/allocations/components/OpenPositionsTable.all-columns.test.tsx" "src/app/(dashboard)/allocations/lib/dust.test.ts"` (+2 more gates) | ❌ W0: HoldingsTabPanel.dust.test.tsx, dust.test.ts (created RED-first by this task or an earlier plan of this phase); ❌ until 194.1 merges: figure-gate-census.test.ts (task precondition) | ⬜ pending |
| 198-12-T1 | 12 | 4 | LEAN-06 | T-198-21, T-198-22, T-198-SC | A flag fans out to every key's row and merges nothing (census) | unit, census | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-12-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/lib/flagged-position-map.test.ts" src/__tests__/holding-scope-key-census.test.ts` | ❌ W0: flagged-position-map.test.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-12-T2 | 12 | 4 | LEAN-06 | T-198-21, T-198-22, T-198-SC | One outcome sub-row, under the row that opened it | unit, component | `npx vitest run "src/app/(dashboard)/allocations/components/PositionsTables.flagged.test.tsx" "src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx" "src/app/(dashboard)/allocations/components/OpenPositionsTable.all-columns.test.tsx" "src/app/(dashboard)/allocations/HoldingsTabPanel.dust.test.tsx" src/__tests__/display-sign-single-source.test.ts` | ❌ W0: PositionsTables.flagged.test.tsx, HoldingsTabPanel.dust.test.tsx (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-12-T3 | 12 | 4 | LEAN-06 | T-198-21, T-198-22, T-198-SC | Writes carry the key-free ref; no flag dropped, dust-hidden ones included | unit, component, census, full suite, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/HoldingsTabPanel.positions-once.test.tsx" "src/app/(dashboard)/allocations/HoldingsTabPanel.flagged-rows.test.tsx" "src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.test.tsx" "src/app/(dashboard)/allocations/ScenarioStub.test.tsx" "src/app/(dashboard)/allocations/components/BridgeDrawer.test.tsx" src/__tests__/holding-scope-key-census.test.ts` (+2 more gates) | ❌ W0: HoldingsTabPanel.positions-once.test.tsx, HoldingsTabPanel.flagged-rows.test.tsx (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |
| 198-13-T1 | 13 | 2 | ROUTE-08 | T-198-23, T-198-SC | Own allocation never labelled unallocated | component | `node scripts/verify-plan-anchors.mjs .planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-13-PLAN.md && npx vitest run "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx"` | ✅ | ⬜ pending |
| 198-13-T2 | 13 | 2 | ROUTE-08 | T-198-23, T-198-SC | Cash labelled through the one shared cash rule | unit, component, typecheck+lint | `npx vitest run "src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx" "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx" src/lib/closed-sets.cash-symbols.test.ts src/__tests__/display-sign-single-source.test.ts` (+1 more gate) | ❌ W0: closed-sets.cash-symbols.test.ts (created RED-first by this task or an earlier plan of this phase) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Filled from the 13 PLAN files at planning time (31 tasks, every one with an `<automated>` verify and a `<fails_when>`). The command column quotes each task's first `<automated>` verbatim, and "+N more gates" counts the rest in that task's `<verify>`. "File Exists" is measured at HEAD `25aa6a16e`: a `❌ W0` file is a test the named task writes RED-first, or one an earlier plan of this phase creates.

---

## Wave 0 Requirements

- [ ] Wave 0 gaps as listed in 198-RESEARCH.md "### Wave 0 Gaps" (book-figures, cash-symbols parity, dust, key-data-gaps, AddAllocationFlow, GlancePanel, MissingDataMessage, positions-once, dust panel, add-param tests). Each is written RED-first inside the task that needs it (`tdd="true"`), so no separate Wave 0 plan exists. The map above names the owning task.
- [ ] `npm ci` in the worktree (plan 198-01 Task 1 runs it first, and every plan carries it as a precondition)
- [ ] Phase 194.1 merged, so `src/__tests__/figure-gate-census.test.ts` exists (D-08, every plan's first-task precondition)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Factsheet "Add to my allocation" lands in the flow | ROUTE-06 | Needs Phase 196 merged | Open a factsheet, click the link, see step 2 pre-filled |

*If none: "All phase behaviors have automated verification."*

---

## Accepted assumptions beyond decision text

Recorded at plan revision (2026-11-08). Each is an assumption the plans implement, not a founder decision.

| Assumption | Beyond which text | Source | Where planned |
|------------|-------------------|--------|---------------|
| An unpriced row ("No price" or `—`) is never dust | D-04's literal rule ("under $50 or under 0.1% of the book") | UI-SPEC A-8 / OQ-8, recommended | 198-02 (`isDust`), 198-11 |
| A row on a key that needs attention (untrusted, disconnected, or missing from the key list) is never dust | D-04's literal rule | UI-SPEC A-8 / OQ-8, recommended | 198-02, 198-11 |
| A flagged row is NOT exempted from dust. While its row is hidden, its flag renders through the shipped flagged list, so it stays reachable in the default view and is listed once | none: D-04 stays literal, and this keeps a match flag reachable | plan-check revision, 2026-11-08 | 198-12 |
| Flagged positions get a row chip and an inline `Record outcome…` action in place of the separate list | UI-SPEC OQ-7, still open | UI-SPEC A-7, research C9 | 198-12 |
| ROUTE-06 has no data-shape edge probe (`unclassified`, status `unresolved`); its states are covered by the UI-SPEC flow-state table the plans lift in full | edge-probe coverage, not a decision | planner, flagged, not auto-resolved | 198-05, 198-08 |

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (31 of 31 tasks)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task has one)
- [x] Wave 0 covers all MISSING references (each `❌ W0` file is written RED-first by its task or created by an earlier plan; `figure-gate-census.test.ts` arrives with Phase 194.1, a precondition)
- [x] No watch-mode flags (`vitest run` and `playwright test --list` only)
- [x] Feedback latency < 180s for per-task commands (the full `npm test` runs once, at the end of 198-12)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
