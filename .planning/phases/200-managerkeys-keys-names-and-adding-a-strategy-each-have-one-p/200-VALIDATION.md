---
phase: "200"
slug: "managerkeys-keys-names-and-adding-a-strategy-each-have-one-p"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-10"
---

# Phase 200 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom default + node project), `@testing-library/react` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <targeted files>` |
| **Full suite command** | `npx vitest run` (CI only; this host runs targeted files: no build, dev server, playwright or local stack) |
| **Estimated runtime** | ~30-90 seconds per targeted set |

---

## Sampling Rate

- **After every task commit:** the task's targeted `npx vitest run <files>` plus `npx eslint <touched files>`
- **After every plan wave:** `npx tsc --noEmit -p .` and the pinned-census set: `display-sign-single-source`, `wizardErrors.roster-render`, `no-store-coverage`, `limiter-ordering`, `dialog-envelope.invariant`, `degrade-warning-scan`, `src/lib/visibility.test.ts`, `status-surface-copy.test.ts`, `key-storage-census`
- **Before `/gsd-verify-work`:** all of the above green; every user-facing or data-integrity gate shown RED by a neuter on a byte copy in the scratchpad, restored with `cp`, `cmp` exit 0
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 200-01-01 | 01 | 1 | ROUTE-09 | T-200-01..04 | feeds read owner-scoped, no-store, batched | route + component | `npx vitest run src/app/api/keys/feeds/route.test.ts src/__tests__/no-store-coverage.test.ts src/lib/api/limiter-ordering.test.ts src/components/strategy/ApiKeyManager.test.tsx` | ❌ W0 (route test new) | ⬜ pending |
| 200-01-02 | 01 | 1 | ROUTE-09 | T-200-01 | additive `feeds`, 500 on read error | route | `npx vitest run "src/app/api/keys/[id]/memberships/route.test.ts"` | ✅ | ⬜ pending |
| 200-02-01 | 02 | 1 | LEAN-04 | T-200-05 | census RED on restatements at HEAD | node census | `npx vitest run src/__tests__/key-storage-census.test.ts` | ❌ W0 (new) | ⬜ pending |
| 200-02-02 | 02 | 1 | LEAN-04 | T-200-05 | one key-storage sentence | census + component | `npx vitest run src/__tests__/key-storage-census.test.ts src/__tests__/public-truth-copy.test.tsx src/components/exchanges/AllocatorExchangeManager.test.tsx` | ✅ | ⬜ pending |
| 200-03-01 | 03 | 1 | ROUTE-10 | T-200-07 | rename only private/draft | unit + component | `npx vitest run src/lib/strategy-display.test.ts src/components/strategy/StrategyNameBlock.test.tsx` | ❌ W0 (block test new) | ⬜ pending |
| 200-03-02 | 03 | 1 | ROUTE-10 | — | no codename claim | component | `npx vitest run src/components/strategy/RenameStrategyDialog.test.tsx` | ✅ | ⬜ pending |
| 200-12-01 | 12 | 1 | ROUTE-10 | T-200-07 | edit form never sends name | component | `npx vitest run src/components/strategy/StrategyForm.test.tsx src/__tests__/display-sign-single-source.test.ts` | ✅ | ⬜ pending |
| 200-12-02 | 12 | 1 | ROUTE-09 | T-200-08 | Data Source card create-only | component | `npx vitest run src/components/strategy/StrategyForm.test.tsx src/components/strategy/StrategyForm.credential-input.test.tsx` | ✅ | ⬜ pending |
| 200-05-01 | 05 | 1 | LEAN-04 | T-200-10 | one header control to the wizard | page | `npx vitest run "src/app/(dashboard)/strategies/page.merged.test.tsx"` | ✅ | ⬜ pending |
| 200-05-02 | 05 | 1 | LEAN-04 | — | one label | component | `npx vitest run src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx src/components/layout/DashboardChrome.test.tsx` | ✅ | ⬜ pending |
| 200-04-01 | 04 | 2 | ROUTE-10 | T-200-11 | no factsheet Rename; owner gates intact | component | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx" "src/app/factsheet/[id]/v2/focus-ring-clipproof.test.tsx"` | ✅ | ⬜ pending |
| 200-04-02 | 04 | 2 | ROUTE-10 | — | no list Rename | component | `npx vitest run src/components/strategy/StrategyTable.visibility.test.tsx src/components/strategy/StrategyTable.owner-list.test.tsx` | ✅ | ⬜ pending |
| 200-04-03 | 04 | 2 | LEAN-04 | — | one dialog mount | component + grep | `npx vitest run "src/app/(dashboard)/strategies/StrategiesSection.test.tsx" "src/app/(dashboard)/strategies/page.merged.test.tsx"` | ✅ | ⬜ pending |
| 200-06-01 | 06 | 2 | ROUTE-09 | T-200-12 | D-05: no write before confirm | component | `npx vitest run src/components/strategy/ApiKeyManager.test.tsx src/lib/dialog-envelope.invariant.test.ts` | ✅ (RED test first) | ⬜ pending |
| 200-06-02 | 06 | 2 | ROUTE-09 | T-200-12 | confirm across file, KCS-23 intact | component | `npx vitest run src/components/strategy/ApiKeyManager.test.tsx` | ✅ | ⬜ pending |
| 200-07-01 | 07 | 2 | LEAN-04, ROUTE-09 | — | API keys tab for every role, `?tab=exchanges` for a manager | component | `npx vitest run src/components/auth/ProfileTabs.test.tsx src/components/exchanges/AllocatorExchangeManager.test.tsx` | ✅ | ⬜ pending |
| 200-07-02 | 07 | 2 | ROUTE-09 | T-200-15 | feeds line; delete confirm names fed strategies | component | `npx vitest run src/components/exchanges` | ✅ | ⬜ pending |
| 200-09-01 | 09 | 2 | ROUTE-09 | T-200-18, T-200-19 | wizard saved-key summary feeds line, could-not-check on failure | component | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.preselect-feeds.test.tsx"` | ❌ W0 (new) | ⬜ pending |
| 200-09-02 | 09 | 2 | ROUTE-09 | — | wizard suites and censuses green | suite | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps" src/__tests__/key-storage-census.test.ts` | ✅ | ⬜ pending |
| 200-10-01 | 10 | 3 | LEAN-04 | T-200-20 | manager-only add, no holdings sync | component | `npx vitest run src/components/exchanges/AllocatorExchangeManager.test.tsx` | ✅ | ⬜ pending |
| 200-10-02 | 10 | 3 | LEAN-04, ROUTE-09 | T-200-21 | Delete key and update password parity for manager-only | component | `npx vitest run src/components/exchanges/AllocatorExchangeManager.test.tsx -t "manager-only parity"` | ✅ | ⬜ pending |
| 200-11-01 | 11 | 3 | ROUTE-09 | T-200-16, T-200-17 | Change key… behind the confirm | component | `npx vitest run src/components/strategy/ApiKeyManager.test.tsx` | ✅ | ⬜ pending |
| 200-11-02 | 11 | 3 | ROUTE-09 | — | poll suite and dialog invariant green | component | `npx vitest run src/components/strategy/ApiKeyManager.poll.test.tsx src/lib/dialog-envelope.invariant.test.ts` | ✅ | ⬜ pending |
| 200-08-01 | 08 | 4 | LEAN-04, ROUTE-09 | T-200-22, T-200-23 | parity gate passes, then the panel shrinks to the current key | component | `npx vitest run src/components/exchanges/AllocatorExchangeManager.test.tsx -t "manager-only parity" && npx vitest run src/components/strategy/ApiKeyManager.test.tsx` | ✅ | ⬜ pending |
| 200-08-02 | 08 | 4 | LEAN-04 | — | censuses green after shrink | census set | 200-08 Task 2 verify | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/app/api/keys/feeds/route.test.ts` — ROUTE-09 (plan 01 Task 1, written first)
- [ ] `src/__tests__/key-storage-census.test.ts` — LEAN-04 (plan 02 Task 1, RED at HEAD)
- [ ] `src/components/strategy/StrategyNameBlock.test.tsx` — ROUTE-10 (plan 03 Task 1)
- [ ] `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.preselect-feeds.test.tsx` — ROUTE-09 (plan 09 Task 1)
- [ ] D-05 RED-first confirm test in `ApiKeyManager.test.tsx` (plan 06 Task 1, committed alone before the gate)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dialog and panel layout at 320px and desktop | ROUTE-09, ROUTE-10 | no browser on this host | at UAT: `/strategies/<id>/edit` Change key… and Rename…; Profile > API keys as a manager-only user |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter (set by validate-phase after execution)

**Approval:** pending
