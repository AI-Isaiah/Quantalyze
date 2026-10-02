---
phase: 21
slug: surfacing-correlation-honest-projection
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-21
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Per-task map populated by the planner (each PLAN.md task carries an `<automated>` verify);
> see 21-RESEARCH.md "## Validation Architecture" for the per-requirement assertion plan.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TypeScript suite) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <changed-spec>` |
| **Full suite command** | `npm test` (coverage gate: `npm run test:coverage` — BLOCKING CI gate per CLAUDE.md) |
| **Estimated runtime** | ~varies (sharded in CI); single-spec sub-30s |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <changed-spec>`
- **After every plan wave:** Run the affected component/lib specs
- **Before `/gsd:verify-work`:** Full suite + `npm run test:coverage` must be green
- **Max feedback latency:** ~30 seconds (single-spec)

---

## Per-Task Verification Map

> Each task's `<automated>` verify is the scoped spec it touches. Every requirement has at least one automated test.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 21-01-T1 | 01 | 1 | SURF-01 | component (extend) | `npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx"` | ⬜ pending |
| 21-01-T2 | 01 | 1 | SURF-02, SURF-03 | component (extend existing Sidebar.test.tsx) | `npx vitest run "src/components/layout/Sidebar.test.tsx"` | ⬜ pending |
| 21-02-T1 | 02 | 1 | IMPACT-01 (support) | unit (new helper) | `npx vitest run "src/lib/scenario-history.test.ts"` | ⬜ pending |
| 21-02-T2 | 02 | 1 | CORR-02, CORR-03, CORR-04 | component (replace truncation tests) | `npx vitest run "src/components/portfolio/CorrelationHeatmap.test.tsx"` | ⬜ pending |
| 21-02-T3 | 02 | 1 | CORR-03 | component (update literal) | `npx vitest run "src/app/(dashboard)/allocations/components/KpiStrip.test.tsx"` | ⬜ pending |
| 21-03-T1 | 03 | 2 | CORR-01, CORR-03 | component (extend) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | ⬜ pending |
| 21-03-T2 | 03 | 2 | IMPACT-01 | component (extend) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | ⬜ pending |
| 21-03-T3 | 03 | 2 | IMPACT-02 | neuter guard (extend R3) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | ⬜ pending |
| 21-04-T1 | 04 | 2 | SURF-03, CORR-03, IMPACT-01 | component (extend) | `npx vitest run "src/components/scenarios/ScenarioBuilder.honesty.test.tsx"` | ⬜ pending |
| 21-04-T2 | 04 | 2 | IMPACT-01, IMPACT-02 | component + neuter guard (NEW file) | `npx vitest run "src/components/scenarios/ScenarioBuilder.honesty.test.tsx"` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> CORRECTION to RESEARCH/UI-SPEC: `src/components/layout/Sidebar.test.tsx` ALREADY EXISTS (32 it/describe blocks, renders Sidebar with isAllocator/isManager/isAdmin props and asserts allocator/manager/admin views). The SURF-02/03 sidebar coverage is therefore an EXTEND (Plan 01 Task 2), NOT a net-new Wave-0 file. Verified by direct `ls`/grep 2026-06-21.

The only genuinely-new test file:

- [ ] `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` — net-new (no ScenarioBuilder test exists today; verified). Created in Plan 04 Task 2. Covers IMPACT-01 framing + the IMPACT-02 neuter guard for the Sandbox surface, modeled on the composer R3 guard.

Updated-not-net-new (handled inline in the owning task, not a separate Wave-0 step):
- `CorrelationHeatmap.test.tsx` — REPLACE the two truncation tests (:100-165) with show-all + reason-named empty-state tests (Plan 02 Task 2).
- `KpiStrip.test.tsx` — update the "Avg ρ" literal (13 occurrences) → "Avg |ρ|" (Plan 02 Task 3). NOTE: the literal lives in `KpiStrip.test.tsx`, NOT `KpiStrip.scenario.test.tsx` (verified).
- `ScenarioComposer.test.tsx` — extend the R3 guard (:2163) with a PercentileRankBadge ABSENT assertion (Plan 03 Task 3) + heatmap/badge/caveat coverage (Plan 03 Tasks 1-2).
- `Sidebar.test.tsx` — add Strategy Sandbox show/hide cases (Plan 01 Task 2).
- `AllocationsTabs.scenario-composer.test.tsx` — add visible-tab + keyboard-reach assertions (Plan 01 Task 1).

*Existing infrastructure (vitest + the R3 guard in `ScenarioComposer.test.tsx`) covers the composer-side requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual heatmap legibility at large N (scroll container) | CORR-04 | Visual density judgment | Open a scenario with >10 strategies; confirm the heatmap scrolls both axes and cell labels stay legible (≥48px cells) |
| PROJECTED badge reads as neutral metadata, not an error/alert | IMPACT-01 | Visual tone judgment | Open the composer + Sandbox; confirm the PROJECTED + Example-universe pills are calm neutral outlines (not amber/red/accent-filled) |

*Most phase behaviors have automated verification; the above are advisory visual checks.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (ScenarioBuilder honesty/neuter spec is the only net-new file; Sidebar test already exists)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-complete (2026-06-21)
