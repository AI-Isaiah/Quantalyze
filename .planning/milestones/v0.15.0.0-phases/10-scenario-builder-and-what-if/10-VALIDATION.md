---
phase: 10
slug: scenario-builder-and-what-if
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-25
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 (frontend + Next.js route handlers) + live Supabase (regression tests) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --reporter=verbose scenario` (changed-area scope) |
| **Full suite command** | `npm test && npx tsc --noEmit && npm run lint` |
| **Estimated runtime** | ~30s quick / ~120s full |

---

## Sampling Rate

- **After every task commit:** Run the task's `<verify><automated>` block (see Per-Task Verification Map)
- **After every plan wave:** Run the per-plan verify commands for all plans in that wave
- **Before `/gsd-verify-work`:** Full suite green + frozen `src/lib/scenario.ts` regression set must remain at zero diff
- **Max feedback latency:** 30 seconds for any single task verify command

---

## Per-Task Verification Map

Each task in each plan has an inline TDD RED-then-GREEN cycle (the RED commit IS the Wave 0 satisfaction). Verify commands extracted from each plan's `<verify><automated>` block.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-T1 | 01 | 1 | SCENARIO-01, 02, 08, 09 | T-10-02, T-10-04 | Per-allocator scoped localStorage key prevents cross-tenant draft leak | unit | `npm test -- scenario-state 2>&1 \| tail -30` | ❌ W0 (RED commit) | ⬜ pending |
| 10-01-T2 | 01 | 1 | SCENARIO-05 | T-10-03, T-10-04 | Adapter uses frozen `src/lib/scenario.ts` invariants verbatim; lookup-map signature avoids stale strategy crashes | unit | `npm test -- scenario-adapter scenario.test 2>&1 \| tail -20` | ❌ W0 (RED commit) | ⬜ pending |
| 10-01-T3 | 01 | 1 | SCENARIO-07 | T-10-01 | Synthetic match_decision shapes carry allocator_id + buildHoldingRef-format scope_ref for ownership gate | unit | `npm test -- holding-outcome-adapter ScenarioFlaggedHoldingsList 2>&1 \| tail -15` | ❌ W0 (RED commit) | ⬜ pending |
| 10-02-T1 | 02 | 1 | SCENARIO-07 | T-10-01, T-10-08, T-10-09 | Migration 080 (kind enum + 4 CHECKs + voluntary_add cron branch H2 + L1/M2 backfill assertions) AND migration 081 (H1 — bridge_outcomes relaxed for voluntary kinds) BOTH ship atomically; ADR-0023 synced | static | `test -f supabase/migrations/080_match_decisions_kind_enum.sql && test -f supabase/migrations/081_bridge_outcomes_relax_for_voluntary.sql && grep -c "ADD CONSTRAINT match_decisions_kind_" supabase/migrations/080_match_decisions_kind_enum.sql && grep -c "voluntary_add_candidates" supabase/migrations/080_match_decisions_kind_enum.sql && grep -c "match_decision_kind" docs/architecture/adr-0023-audit-event-taxonomy.md && grep -c "bridge_outcomes_allocator_match_decision_unique" supabase/migrations/081_bridge_outcomes_relax_for_voluntary.sql` | ❌ W0 (RED commit) | ⬜ pending |
| 10-02-T2 | 02 | 1 | SCENARIO-07 | T-10-01, T-10-08, T-10-09 | **[BLOCKING]** schema push to live Supabase succeeds for BOTH 080 + 081; self-verifying DO blocks emit all NOTICE assertions before any commit-route code can run | integration (live DB) | `SUPABASE_ACCESS_TOKEN=${SUPABASE_ACCESS_TOKEN:-$(security find-generic-password -s "supabase-cli" -w 2>/dev/null)} supabase db push --include-all 2>&1 \| tee /tmp/migration-080-081-push.log \| grep -E "phase10\|Migration 08[01]: all\|Applying migration 08[01]"` | autonomous: false (human checkpoint) | ⬜ pending |
| 10-02-T3 | 02 | 1 | SCENARIO-07 | T-10-01, T-10-08, T-10-09 | Live-DB regression confirms kind column + 4 match_decisions CHECKs + backfill (M2/L1) + voluntary_remove/voluntary_add round-trip through bridge_outcomes (H1) + voluntary_add cron branch fires (H2) | integration (live DB) | `npm test -- match-decisions-schema bridge-outcomes-voluntary-schema bridge-outcome-cron-voluntary-add 2>&1 \| tail -30` | ❌ W0 (RED commit) | ⬜ pending |
| 10-03-T1 | 03 | 1 | SCENARIO-05 | — | Server-side reconstruction at SSR; per-symbol return-series sorted ascending; rows where prev=0 skipped (no division-by-zero) | unit | `npm test -- getMyAllocationDashboard.scenario queries 2>&1 \| tail -25 && npx tsc --noEmit 2>&1 \| head -20` | ❌ W0 (RED commit) | ⬜ pending |
| 10-03-T2 | 03 | 1 | SCENARIO-04 | — | Route returns ONLY published strategies + null-safe column mapping (markets/strategy_types null → []) + RLS-safe (no admin client) | unit + integration | `npm test -- strategies/browse 2>&1 \| tail -15 && npx tsc --noEmit 2>&1 \| head -20` | ❌ W0 (RED commit) | ⬜ pending |
| 10-04-T1 | 04 | 2 | SCENARIO-05, 06 | — | mode='live' default preserves Phase 09.1 D-09 + warmup invariants verbatim; mode='scenario' suppresses delta pills when warmingUp=true | unit | `npm test -- KpiStrip 2>&1 \| tail -25` | ❌ W0 (RED commit) | ⬜ pending |
| 10-04-T2 | 04 | 2 | SCENARIO-05, 06 | T-10-03 | EquityChart scenarioSeries overlay accepts wealth-multiplier values (≥0.95 sanity bound after +1 conversion); 3-state visibility toggle preserves baseline-only mode | unit | `npm test -- EquityChart equity-curve.equitydailypoints 2>&1 \| tail -25` | ❌ W0 (RED commit) | ⬜ pending |
| 10-04-T3 | 04 | 2 | SCENARIO-05, 06 | T-10-03 | DrawdownChart scenarioDailyPoints overlay scaled by scenario AUM; second Recharts Area series stacks correctly | unit | `npm test -- DrawdownChart equity-curve.equitydailypoints 2>&1 \| tail -20` | ❌ W0 (RED commit) | ⬜ pending |
| 10-05-T1 | 05 | 3 | SCENARIO-03 | — | mandate-fit.ts client-side approximation matches RESEARCH Pitfall 7 algorithm; pure TS (no DOM, no fetches) | unit | `npm test -- mandate-fit 2>&1 \| tail -15` | ❌ W0 (RED commit) | ⬜ pending |
| 10-05-T2 | 05 | 3 | SCENARIO-04 | — | StrategyBrowseDrawer 620px slide-over, escape-to-close, focus-trap, single fetch on open, client-side filter | component | `npm test -- StrategyBrowseDrawer 2>&1 \| tail -25` | ❌ W0 (RED commit) | ⬜ pending |
| 10-05-T3 | 05 | 3 | SCENARIO-03 | — | BridgeDrawer "Add to scenario" CTA in confirm stage; existing Bridge flow untouched (Phase 09 regression set green) | component | `npm test -- BridgeDrawer 2>&1 \| tail -20` | ❌ W0 (RED commit) | ⬜ pending |
| 10-06a-T1 | 06a | 4 | SCENARIO-01, 02, 08, 09 | T-10-02, T-10-04 | useScenarioState hook hydrates from per-allocator scoped storage key; on allocatorId change clears prior draft (T-10-02 mitigation); ScenarioFooter sticky | unit + component | `npm test -- useScenarioState ScenarioFooter 2>&1 \| tail -25` | ❌ W0 (RED commit) | ⬜ pending |
| 10-06b-T1 | 06b | 5 | SCENARIO-01, 03, 04, 05, 06, 08, 09 | T-10-03, T-10-04 | ScenarioComposer assembles full body; equity_curve `+1` wealth conversion before EquityChart; ×scenarioAUM before DrawdownChart; B4-pinned adapter signature (AddedStrategy + lookup maps) | component | `npm test -- ScenarioComposer ScenarioStub ScenarioFlaggedHoldingsList AllocationDashboardV2 2>&1 \| tail -30` | ❌ W0 (RED commit) | ⬜ pending |
| 10-06b-T2 | 06b | 5 | SCENARIO-01 | — | AllocationsTabs scenario panel branches on allocations.ui_v2 flag; ScenarioStub fallback preserved when flag off (Phase 07 regression green) | component | `npm test -- AllocationsTabs.scenario-composer AllocationsTabs ScenarioStub AllocationDashboardV2 2>&1 \| tail -20` | ❌ W0 (RED commit) | ⬜ pending |
| 10-07-T1 | 07 | 6 | SCENARIO-07 | T-10-01 | Discriminated-zod commit route; per-kind insert; admin client + `.eq("allocator_id", user.id)` ownership gate; audit row per diff | integration (live DB) | `npm test -- src/app/api/allocator/scenario/commit/route.test.ts bridge-outcomes-rls match-decisions-holding-endpoint-rls 2>&1 \| tail -25` | ❌ W0 (RED commit) | ⬜ pending |
| 10-07-T2 | 07 | 6 | SCENARIO-07 | — | ScenarioCommitDrawer 720px grouped removals/additions; composer wire-in calls `toVoluntaryRemoveDecision` + `toVoluntaryAddDecision` to derive form props (N3) | component | `npm test -- ScenarioCommitDrawer ScenarioComposer 2>&1 \| tail -25` | ❌ W0 (RED commit) | ⬜ pending |
| 10-07-T3 | 07 | 6 | SCENARIO-07 | T-10-01 | Cross-tenant insert blocked at API layer (admin-client ownership gate fails) AND at DB layer (RLS); per-kind invariant CHECKs reject malformed inserts | integration (live DB) | `npm test -- scenario-commit-rls 2>&1 \| tail -20` | ⬜ pending | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*File Exists column: ❌ W0 means file is created in the task's RED commit (Wave 0 satisfied inline per TDD).*

---

## Wave 0 Requirements

Inline TDD: each task above ships a RED commit that creates the test file before the GREEN commit lands the implementation. The RED commit IS the Wave 0 artifact for that task. Files created in Wave 0 (across all 8 plans):

- [x] `src/app/(dashboard)/allocations/lib/scenario-state.ts` + `.test.ts` + `.localStorage.test.ts` (10-01-T1 RED)
- [x] `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` + `.test.ts` (10-01-T2 RED)
- [x] `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.ts` voluntary-kind branches + `.test.ts` (10-01-T3 RED)
- [x] `supabase/migrations/080_match_decisions_kind_enum.sql` + `supabase/migrations/081_bridge_outcomes_relax_for_voluntary.sql` + `src/__tests__/match-decisions-schema.test.ts` + `src/__tests__/bridge-outcomes-voluntary-schema.test.ts` (H1) + `src/__tests__/bridge-outcome-cron-voluntary-add.test.ts` (H2) (10-02-T1 / T3 RED)
- [x] `src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` (10-03-T1 RED)
- [x] `src/app/api/strategies/browse/route.test.ts` (10-03-T2 RED)
- [x] `src/app/(dashboard)/allocations/components/KpiStrip.scenario.test.tsx` (10-04-T1 RED)
- [x] `src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx` (10-04-T2 RED)
- [x] `src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.scenario.test.tsx` (10-04-T3 RED)
- [x] `src/app/(dashboard)/allocations/lib/mandate-fit.test.ts` (10-05-T1 RED)
- [x] `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx` (10-05-T2 RED)
- [x] `src/app/(dashboard)/allocations/components/BridgeDrawer.test.tsx` extension (10-05-T3 RED)
- [x] `src/app/(dashboard)/allocations/hooks/useScenarioState.test.tsx` + `ScenarioFooter.test.tsx` (10-06a-T1 RED)
- [x] `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (10-06b-T1 RED)
- [x] `src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx` (10-06b-T2 RED)
- [x] `src/app/api/allocator/scenario/commit/route.test.ts` (10-07-T1 RED)
- [x] `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx` (10-07-T2 RED)
- [x] `src/__tests__/scenario-commit-rls.test.ts` (10-07-T3 RED)

**Frozen invariants — must remain at zero diff:**
- `src/lib/scenario.ts` (no modifications across all 8 plans)
- `src/lib/__tests__/scenario.test.ts` (regression set must remain green throughout phase)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Scenario tab visual deltas (badges, equity overlay, drawdown overlay) match design intent per UI-SPEC | SCENARIO-06 | Visual verification — automated tests confirm data shape, not pixel layout, font tokens, or color tokens | Open `/allocations` as demo allocator with `localStorage.allocations.ui_v2 = "true"`, switch to Scenario tab, toggle one holding, add one Bridge candidate, confirm: (a) delta badges render in correct color tokens per D-16 direction map; (b) equity-curve overlay is visible and dashed; (c) drawdown overlay is correctly stacked; (d) all numeric labels use Geist Mono; (e) layout matches `10-UI-SPEC.md` Component Inventory |
| End-to-end commit through Bridge `RejectedForm` + `AllocatedForm` lands in outcomes timeline | SCENARIO-07 | Cross-component flow — exercises real intro flow + DB writes (live Supabase) | Build a 1-add / 1-remove scenario, click Commit, walk through ScenarioCommitDrawer, fill `RejectedForm` reason + `AllocatedForm` weight, confirm both rows appear in `/allocations` outcomes tab with correct `kind` field (`voluntary_remove` and `voluntary_add`) |
| localStorage resume after hard reload, with strategy that's been deleted from DB since draft | SCENARIO-08 | Race condition — staged drafts can outlive their referent (T-10-04) | Build a draft including a strategy, manually delete that strategy in Supabase, reload — scenario must NOT crash; should surface a non-blocking warning (fingerprint banner or stale-strategy badge) and let user remove the orphaned add |
| Per-allocator scoped localStorage prevents cross-tenant draft leak | SCENARIO-08 | Defense-in-depth verification (T-10-02 / N1 mitigation) | Sign in as Allocator A, build a draft, sign out, sign in as Allocator B, open Scenario tab — must initialize from B's holdings (NOT A's draft). Inspect localStorage: keys must be `allocations.scenario_v0_15.{allocatorId}` (allocator-scoped), not the unscoped legacy key |
| **L7 — Sticky footer z-index audit** | SCENARIO-02 / SCENARIO-09 | Pixel-level verification — automated tests confirm role/aria but not visual stacking | Open the Scenario tab as an allocator with both flagged holdings AND existing outcomes. Open a HoldingNoteRow (sticky sub-row from Phase 08) AND the OutcomesWidget expandable sub-row at the same time, then scroll. The ScenarioFooter (sticky bottom, z-index 10) MUST stay above the page background but MUST NOT overlap or visually clip the HoldingNoteRow / OutcomesWidget sub-row stickies. Confirm: footer remains visible at the bottom edge, no element on the row above it is occluded, and any expanded sub-row content (note text, outcome timeline) is readable end-to-end. Also probe via Playwright (optional, future enhancement): take a screenshot at scrolled-to-mid-page and assert footer's bounding rect does not intersect any element with class "holding-note-row" or "outcomes-widget-row". |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (20/20 tasks across 8 plans)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (inline TDD RED commits per task)
- [x] No watch-mode flags in any verify command
- [x] Feedback latency < 30s per task
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-25
