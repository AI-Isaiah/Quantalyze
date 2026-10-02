---
phase: 112
slug: weights-leverage-rows-per-constituent-weights-leverage
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-17
---

# Phase 112 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `112-RESEARCH.md` → Validation Architecture. Engine is byte-frozen (SC-3); this phase is client UI + client-state wiring.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 (+ `@vitest/coverage-v8` 4.1.10) |
| **Config file** | `vitest.config.ts` (coverage thresholds: lines 82 / statements 80 / functions 74 / branches 72) |
| **Quick run command** | `npx vitest run src/app/\(dashboard\)/allocations --no-file-parallelism` |
| **Full suite command** | `npm test` (sharded in CI with `--coverage`) |
| **Estimated runtime** | ~90s (allocations dir) / full suite minutes (CI-sharded) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test file> --no-file-parallelism`
- **After every plan wave:** Run `npx vitest run src/app/\(dashboard\)/allocations src/lib/scenario.test.ts src/lib/leverage.test.ts`
- **Before `/gsd:verify-work`:** Full suite green **AND** `git diff --exit-code src/lib/scenario.ts` clean (SC-3 freeze)
- **Max feedback latency:** ~90s (quick), CI-sharded for full

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 112-00-01 | 00 | 0 | WEIGHTS-01/02 | — | RED-proof: sum-to-1 across mixed per-key+added fails WITHOUT the engine-unit basis fix; per-key leverage survives Save→reopen | unit+component | `npx vitest run src/app/\(dashboard\)/allocations/lib/scenario-state-apply-weights.test.ts src/app/\(dashboard\)/allocations/components/ScenarioComposer.save.test.tsx` | ❌ W0 | ⬜ pending |
| 112-01-01 | 01 | 1 | WEIGHTS-01 | — | Per-key/strategy-level row renders a weight input; typed weight reaches `projectionState`/blend via the engine-unit basis (not `enabledIdsOf`) | component | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` | ✅ (extend) | ⬜ pending |
| 112-01-02 | 01 | 1 | WEIGHTS-01 | — | Sum-to-1 invariant holds across mixed per-key + added; per-key exclude shrinks the denominator honestly | unit | `npx vitest run src/app/\(dashboard\)/allocations/lib/scenario-state-apply-weights.test.ts` | ✅ (Wave 0) | ⬜ pending |
| 112-02-01 | 02 | 2 | WEIGHTS-02 | — | Per-row leverage re-derives the blend (`wᵢ·Lᵢ·rᵢ`); engine unchanged (behavior pin) | unit | `npx vitest run src/lib/scenario.test.ts` | ✅ | ⬜ pending |
| 112-02-02 | 02 | 2 | WEIGHTS-02 | T-injection | Bad leverage value cannot delete the draft (sanitize-on-read, never a zod refine); per-key leverage survives Save→reopen (prune fix) | unit+component | `npx vitest run src/lib/leverage.test.ts src/app/\(dashboard\)/allocations/components/ScenarioComposer.save.test.tsx` | ✅ (extend) + ❌ W0 | ⬜ pending |
| 112-GATE | — | final | SC-3 freeze | — | `scenario.ts` byte-frozen; orphan grep gate green | gate | `git diff --exit-code src/lib/scenario.ts` + `npx vitest run src/lib/scenario-backbone-gates.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (Plan 112-00 — actual files)

- [ ] `scenario-state-apply-weights.test.ts` — sum-to-1 across mixed per-key + added via the engine-unit basis; RED-proof the invariant fails WITHOUT the basis fix (characterization pin that `setWeightOverride`'s `enabledIdsOf` basis leaves per-key untouched → sum≠1); preserve/restore per-key weight across toggle.
- [ ] `ScenarioComposer.test.tsx` — per-key row renders weight + leverage inputs; per-key weight reaches the blend (goes green in Plan 01/02).
- [ ] `ScenarioComposer.save.test.tsx` — per-key leverage-only edit survives Save→reopen (RED-proof the prune-drop before the 112-02 fix); hostile leverage value (NaN/negative/Infinity/huge) cannot delete the draft (sanitize-on-read pin).
- [ ] No new framework install — Vitest already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Levered-KPI honesty labels render (Sharpe/Sortino/Calmar invariance caveat; notional as derived read-only) | WEIGHTS-02 honesty | Copy/visual assertion better proven in `/qa` on a dev server than a brittle text-match unit test | Load composer with a levered per-key constituent; confirm the notional column reads as derived/informative and the risk-adjusted caveat is present per DESIGN.md Numbers Contract |

*Automated coverage carries the math + wiring; the honesty copy is the one manual QA check.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (the ❌ W0 test files above)
- [x] No watch-mode flags (always `vitest run`, never `vitest` watch)
- [x] Feedback latency < 90s (quick command)
- [x] `nyquist_compliant: true` set in frontmatter
- [ ] `wave_0_complete: true` — flips when Plan 112-00 RED scaffold lands and runs

**Approval:** approved 2026-07-17 (plan-checker VERIFICATION PASSED, 0 blockers)
