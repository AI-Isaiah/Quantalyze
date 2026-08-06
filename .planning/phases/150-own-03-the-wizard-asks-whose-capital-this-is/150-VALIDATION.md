---
phase: 150
slug: own-03-the-wizard-asks-whose-capital-this-is
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-06
planned: 2026-08-06
---

# Phase 150 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Filled at plan time (2026-08-06); Status / Observed columns close during execution (Plan 08 Task 2).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (jsdom) + pgTAP (`supabase/tests/test_*.sql`, CI-discovered at `.github/workflows/ci.yml:1015-1017`) |
| **Config file** | `vitest.config.ts` (coverage thresholds 82/80/74/72 — blocking) |
| **Quick run command** | `npx vitest run <file> --no-file-parallelism` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick < 30s per file; full suite ~several min (sharded in CI) |

⚠️ `*_rls.test.ts` live-DB vitest NEVER runs in CI — every DB-tier assertion in this phase is pgTAP (MEMORY `reference_db_test_ci_wiring`).
⚠️ CI is Node 22, local is 25 — reproduce CI-only failures via `PATH=/opt/homebrew/opt/node@22/bin`.

---

## Sampling Rate

- **After every task commit:** the task's `<automated>` command + the collision-risk gates touched by that task's files (phase-147 / phase-148 / phase-149 / visibility / format-percent-contract — each runs in seconds)
- **After every plan wave:** `npm test` (full vitest)
- **Before `/gsd:verify-work`:** full suite + `npm run test:coverage` + `npx tsc --noEmit` + `npm run lint` green; pgTAP applied-and-green on TEST
- **Max feedback latency:** ~150 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 150-01-01 | 01 | 1 | OWN-03 (D-03, D-04, D-13) | T-150-01/02/03/06 | INSERT (incl. upsert arm) blocked unless own_capital; alias UPDATE on legacy rows unharmed; flip is one txn | DB (pgTAP) | CI pgTAP run of `supabase/tests/test_capital_ownership_column.sql` + `test_capital_ownership_allocation_guard.sql` | ❌ W0 (this task creates them) | ⬜ pending |
| 150-01-02 | 01 | 1 | OWN-03 | T-150-01 | migration applied to TEST before merge (checkpoint) | manual/CLI | information_schema queries on TEST (pasted at checkpoint) | n/a | ⬜ pending |
| 150-02-01 | 02 | 1 | OWN-03 | T-150-07 | single-source predicate; validator lift behavior-identical | unit | `npx vitest run src/lib/capital-ownership.test.ts src/lib/dollar-validation.test.ts "src/app/api/strategies/finalize-wizard/route.test.ts" --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 150-02-02 | 02 | 1 | OWN-03 | T-150-08 | unknown mark never renders a trusted badge (null → nothing) | unit (RTL) | `npx vitest run src/components/strategy/OwnershipTag.test.tsx --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 150-02-03 | 02 | 1 | OWN-03 (D-01) | — | radio semantics; copy single-sourced; controlled, never null | unit (RTL) | `npx vitest run src/components/strategy/CapitalOwnershipRadioGroup.test.tsx --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 150-03-01 | 03 | 2 | OWN-03 (D-01, D-05..D-08, SC 1b) | — | cull render-only (payload deep-equal); asset-class hoist; question default (b) | unit (RTL) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx" --no-file-parallelism` | ✅ extend | ⬜ pending |
| 150-03-02 | 03 | 2 | OWN-03 (D-07, D-10) | T-150-12 | contribution-only render gate; no allocate-now affordance | unit + tsc | `npx tsc --noEmit && npx vitest run "src/app/(dashboard)/strategies/new/wizard" --no-file-parallelism` | ✅ | ⬜ pending |
| 150-03-03 | 03 | 2 | OWN-03 (D-02, SC 2) | T-150-09/10/11 | closed-set 400 pre-RPC; owner-predicated post-RPC UPDATE; lost mark degrades to NULL, never a wizard error arm | route unit | `npx vitest run "src/app/api/strategies/finalize-wizard/route.test.ts" --no-file-parallelism` | ✅ extend | ⬜ pending |
| 150-04-01 | 04 | 2 | OWN-03 (D-09, D-11, SC 2b) | T-150-13/16/17/18/19 | 404-not-ok-on-zero-rows; 409-until-confirmed flip; RPC-only removal | route unit | `npx vitest run "src/app/api/strategies/[id]/ownership/route.test.ts" --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 150-04-02 | 04 | 2 | OWN-05 (D-16, D-17, D-18) | T-150-13/14/15 | owner-only + private/draft server-side; reject-not-truncate; B10 clean | route unit | `npx vitest run "src/app/api/strategies/[id]/name/route.test.ts" src/lib/visibility.test.ts --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 150-05-01 | 05 | 2 | OWN-03 (D-13, D-14, SC 4) | T-150-21/22/23/24/26 | upsert-shaped; pre-checks 404/409; no current_weight; cap enforced before token burn | route unit | `npx vitest run "src/app/api/portfolio-strategies/allocation/route.test.ts" --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 150-05-02 | 05 | 2 | OWN-03 (D-12) | — | inline tenant gate; paired series select | static-analysis | `npx vitest run src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism` | ✅ | ⬜ pending |
| 150-05-03 | 05 | 2 | OWN-03 + OWN-05 (D-12, D-15, SC 1c) | T-150-25 | own-capital-only row set; honest nulls; owner name carve-out | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts" --no-file-parallelism` | ✅ extend | ⬜ pending |
| 150-06-01 | 06 | 3 | OWN-03 + OWN-05 | T-150-28/30 | fetch-only writes; 409→confirm→confirmed-write arc; validation never disables CTA | unit (RTL) | `npx vitest run src/components/strategy/MarkOwnershipDialog.test.tsx src/components/strategy/RenameStrategyDialog.test.tsx --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 150-06-02 | 06 | 3 | OWN-03 (D-09) + OWN-05 | T-150-29 | 149 pins intact (esp. pin 7 window, pin 2 public negatives) | structural | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts --no-file-parallelism` | ✅ | ⬜ pending |
| 150-06-03 | 06 | 3 | OWN-03 + OWN-05 (SC 1c) | T-150-27 | owner-lane-only render; nothing enters the cached payload; anon still 404s | structural + unit | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" --no-file-parallelism` | ✅ extend | ⬜ pending |
| 150-07-01 | 07 | 3 | OWN-03 (D-12, D-15) | T-150-31 | unsigned weight pinned; never-both-buttons; three arms in priority order | unit (RTL) | `npx vitest run "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx" src/__tests__/format-percent-contract.test.ts --no-file-parallelism` | ✅ extend | ⬜ pending |
| 150-07-02 | 07 | 3 | OWN-03 (SC 2) | T-150-32/34 | inline validation, no fetch on invalid; honest weight fallback; envelope on write failure | unit (RTL) | `npx vitest run "src/app/(dashboard)/allocations/components/AllocateDialog.test.tsx" --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 150-07-03 | 07 | 3 | OWN-03 | — | server-fetch wiring, no client reads | tsc + tree | `npx tsc --noEmit && npx vitest run "src/app/(dashboard)/allocations" --no-file-parallelism` | ✅ | ⬜ pending |
| 150-08-01 | 08 | 4 | OWN-03 (SC 2b, SC 3) | T-150-35/36 | seven mutation-proven pins; rot-guarded census | static-analysis | `npx vitest run src/__tests__/phase-150-capital-ownership-invariant.test.ts --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 150-08-02 | 08 | 4 | all | — | full surface green; ledger closed | regression | `npm test && npx tsc --noEmit && npm run lint` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_capital_ownership_column.sql` — column shape (Plan 01 Task 1)
- [ ] `supabase/tests/test_capital_ownership_allocation_guard.sql` — trigger + PK + flip RPC + legacy-alias regression (Plan 01 Task 1)
- [ ] `src/lib/capital-ownership.test.ts`, `src/lib/dollar-validation.test.ts` (Plan 02)
- [ ] `src/components/strategy/OwnershipTag.test.tsx`, `CapitalOwnershipRadioGroup.test.tsx` (Plan 02)
- [ ] `src/app/api/strategies/[id]/ownership/route.test.ts`, `.../name/route.test.ts` (Plan 04)
- [ ] `src/app/api/portfolio-strategies/allocation/route.test.ts` (Plan 05)
- [ ] `MarkOwnershipDialog.test.tsx`, `RenameStrategyDialog.test.tsx` (Plan 06), `AllocateDialog.test.tsx` (Plan 07)
- [ ] `src/__tests__/phase-150-capital-ownership-invariant.test.ts` (Plan 08)
- [x] Framework install: none — Vitest, Playwright and pgTAP CI wiring all exist
- [x] `MetadataStep.test.tsx` EXISTS (research A4 corrected at plan time) — extend, not create

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration applied to TEST before merge | OWN-03 | MCP tools stripped from subagents (#13898); apply_migration is orchestrator-only | Plan 01 Task 2 checkpoint: MCP `apply_migration` → qmnijlgmdhviwzwfyzlc, paste the two information_schema query outputs |
| Live retro path on real data | OWN-03 (D-11) | Black Swan / Alpha Centauri / Arctic Fox are PROD rows | at phase /qa: mark one legacy strategy own-capital on a real session, see it appear in Holdings, allocate, edit, remove |
| 148 adversarial cache acceptance on a live deploy | OWN-03 (cache) | unstable_cache behavior is runtime, not unit | after an owner views a draft factsheet, anon request for same id still 404s (Phase-148 procedure) |

---

## Falsifiability Ledger

> One row per success criterion. Mutations are semantic edits to PRODUCTION source, run and observed.
> Fill Observed at execution time — "asserted" is not evidence (142.1 item-14 lesson: pending ≠ skipped ≠ observed).

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 (question, default b) | `MetadataStep.tsx`: initialize the question state to `OWN_CAPITAL` instead of `TEAM_REVIEW` | MetadataStep.test.tsx default-selection case | ⬜ pending | |
| SC-1 (allocator-only render) | `WizardClient.tsx`: pass `showCapitalQuestion={true}` unconditionally (drop the contribution derivation) | MetadataStep/WizardClient render-gate case | ⬜ pending | |
| SC-1b (render-only cull) | `MetadataStep.tsx`: drop one culled field (e.g. `aum`) from the `onComplete` payload | MetadataStep payload deep-equal case | ⬜ pending | |
| SC-1c (rename server gate) | `name/route.ts`: remove `.in("status", ["private","draft"])` from the UPDATE chain | name route published-row-404 case | ⬜ pending | |
| SC-1c (Holdings label) | `strategies-row-adapter.ts`: revert the owner carve-out (drop `s.name` from the resolution chain) | adapter wizard-shaped rename-visibility case | ⬜ pending | |
| SC-2 (mark persistence) | `finalize-wizard/route.ts`: drop `.eq("user_id", user.id)` from the mark UPDATE | finalize route ownership-predicate assertion | ⬜ pending | |
| SC-2 (allocate write) | `allocation/route.ts`: change upsert to plain `.insert(` | allocation route second-POST-edits case (and pgTAP PK case turns the behavior visible) | ⬜ pending | |
| SC-2b (trigger scope) | migration: `BEFORE INSERT` → `BEFORE INSERT OR UPDATE` on the trigger statement | phase-150 gate P4 (no-OR-UPDATE pin); pgTAP legacy-alias case on TEST | ⬜ pending | |
| SC-2b (predicate) | `capital-ownership.ts`: `isAllocatable` → `return mark !== null` | predicate truth-table + adapter row-set cases | ⬜ pending | |
| SC-2b (census, second member) | add a `.upsert(` on `portfolio_strategies` to `RemoveStrategyButton.tsx` | phase-150 gate P2 (rot-guarded allowlist) | ⬜ pending | |
| SC-3 (no auto-add) | `finalize-wizard/route.ts`: insert a `portfolio_strategies` write after the mark UPDATE | phase-150 gate P2 names the file; route test call-census | ⬜ pending | |
| SC-4 (duplicate-add) | pgTAP: second INSERT of the same (portfolio_id, strategy_id) | pgTAP PK-violation case (positive proof the PK holds) | ⬜ pending | |
| SC-2b (atomic flip) | `ownership/route.ts`: replace the rpc call with sequential `.update()` + `.delete()` | phase-150 gate P6; ownership route RPC-call assertion | ⬜ pending | |
| money (weight skew) | `allocation/route.ts`: add `current_weight: 0.5` to the upsert payload | phase-150 gate P3; allocation route payload assertion | ⬜ pending | |

---

## Oracle Independence

- [ ] No test imports a **constant** from the module it tests — copy strings (UI-SPEC Copywriting Contract), the $1B cap, and the mark literals are typed into tests as LITERALS
- [ ] No assertion compares a value to itself via a re-export, fixture, or table under test
- [ ] Allowlist sizes in the phase-150 gate pinned to literal path lists with rot-guards, not `len(...)`
- [ ] pgTAP fixtures assert DB behavior against literal expected values, never against the trigger's own message re-read

*Deliberate exceptions:* none planned. If execution introduces one, name it here with its independent cover.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (map above: every task has one; the only manual item is the Plan-01 checkpoint)
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 150s
- [x] **Every success criterion has a Falsifiability Ledger row**
- [ ] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason** (closes in Plan 08 Task 2)
- [ ] **Oracle Independence checklist complete** (closes in Plan 08 Task 2)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (execution closes the Observed columns; Plan 08 Task 2 flips status)
