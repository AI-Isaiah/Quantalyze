---
phase: 149
slug: nav-my-strategies-a-ranking-at-discovery-parity
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-05
planned: 2026-08-05
---

# Phase 149 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sources: 149-RESEARCH.md §Validation Architecture (per-SC test map), 149-PATTERNS.md §9/§11,
> orchestrator/founder rulings 2026-08-05 (own-only predicate, toggle-hide, placeholder census).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS suite, jsdom via file pragma) + Playwright (e2e, regression-only here) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <touched test files> --no-file-parallelism` |
| **Full suite command** | `npm run test:coverage && npm run typecheck && npm run lint` — ⚠️ NOT bare `npm test` (proves nothing about the blocking 82/80/74/72 coverage gate; 148-VALIDATION correction) |
| **Estimated runtime** | ~300 s full · <30 s targeted |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched test files> --no-file-parallelism`
- **After every plan wave:** `npm test && npm run typecheck && npm run lint`
- **Before `/gsd:verify-work`:** full suite green + the 148 regression pair (SC-5c) + `npx playwright test e2e/discovery.spec.ts e2e/discovery-prefs-isolation.spec.ts` (the two public surfaces whose invariance this phase claims)
- **Max feedback latency:** 300 s (full), <30 s (targeted)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 149-01-01 | 01 | 1 | NAV-01 | T-149-01 | default drops unpublished rows; owner recipe renders them | component unit (RED-first) | `npx vitest run src/components/strategy/StrategyTable.visibility.test.tsx --no-file-parallelism` | ❌ W0 (created by task) | ⬜ pending |
| 149-01-02 | 01 | 1 | NAV-01 | T-149-01/02/03 | literal default; grid unreachable; Simulate published-gated | same + existing 912-line suite untouched | `npx vitest run src/components/strategy/StrategyTable.visibility.test.tsx src/components/strategy/StrategyTable.test.tsx --no-file-parallelism` | ✅ after 01-01 | ⬜ pending |
| 149-02-01 | 02 | 1 | NAV-01 | T-149-04/05 | own-only predicate; census-correct anti-join (strategy_keys covered) | pure-fn unit + gate regression | `npx vitest run src/lib/queries.my-strategies.test.ts src/__tests__/phase-147-series-resolution-guards.test.ts src/__tests__/phase-84-asset-class-flow.test.ts src/__tests__/phase-63-series-space-guards.test.ts --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 149-02-02 | 02 | 1 | NAV-01 | — | `private` → muted `Private`, fallback contract preserved | component unit (RED-first) | `npx vitest run src/components/ui/Badge.test.tsx --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 149-03-01 | 03 | 2 | NAV-01 | T-149-09/10 | chips owner-gated; never 0.00/+0.0%; muted/amber only | component unit (RED-first) | `npx vitest run src/components/strategy/StrategyTable.pending-chip.test.tsx --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 149-03-02 | 03 | 2 | NAV-01 | T-149-08 | placeholders outside #n, absent on public, button not a /strategies link | component unit (RED-first) | same file | ✅ after 03-01 | ⬜ pending |
| 149-04-01 | 04 | 3 | NAV-01 | T-149-11/12/14/15 | `.eq("user_id", uid)` chain-recorded; noStore; real N; allocator literal | RSC page unit + lint | `npx vitest run "src/app/(dashboard)/my-strategies/page.test.tsx" "src/app/(dashboard)/requireRolePage-wiring.test.tsx" --no-file-parallelism && npm run lint` | ❌ W0 | ⬜ pending |
| 149-04-02 | 04 | 3 | NAV-01 | T-149-13 | entry allocator-branch-only; `<a href="/my-strategies">`; manager negative | component unit + frozen-spine gate | `npx vitest run src/components/layout/Sidebar.test.tsx src/__tests__/phase-32-frozen-spine-guards.test.ts --no-file-parallelism` | ✅ EXTEND | ⬜ pending |
| 149-05-01 | 05 | 4 | NAV-01 | T-149-16/17 | 11 structural pins incl. anti-vacuity | source-scan unit | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts --no-file-parallelism` | ❌ W0 | ⬜ pending |
| 149-05-02 | 05 | 4 | NAV-01 | T-149-18 | ≥4 observed-RED mutations; phase gate; public e2e invariance | mutation runs + full suite | `npm run test:coverage && npm run typecheck && npm run lint` + 148 pair + 2 e2e specs | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Created inside the plans that consume them (test-first task ordering; every code task is preceded
or accompanied by its RED-first spec in the same plan):

- [ ] `src/components/strategy/StrategyTable.visibility.test.tsx` — SC-1c/2a/2b/4c/5a + toggle-hide + Simulate gate (plan 01 task 1; ⛔ MUST be observed RED against today's `StrategyTable.tsx:331`)
- [ ] `src/lib/queries.my-strategies.test.ts` — pure anti-join falsifier incl. the Alpha Centauri strategy_keys case (plan 02 task 1)
- [ ] `src/components/ui/Badge.test.tsx` — SC-4b (plan 02 task 2; file confirmed absent by pattern mapper)
- [ ] `src/components/strategy/StrategyTable.pending-chip.test.tsx` — SC-4a/4b + Delta-5 placeholders (plan 03)
- [ ] `src/app/(dashboard)/my-strategies/page.test.tsx` — SC-1b/2c; ⛔ chain-recording supabase double, never an identity stub (148 Pitfall-5 lesson) (plan 04 task 1)
- [ ] **Edit** `src/components/layout/Sidebar.test.tsx` — SC-1a role matrix (plan 04 task 2)
- [ ] **Edit** `src/app/(dashboard)/requireRolePage-wiring.test.tsx` — GATE-a 8th SURFACES entry, same commit as page.tsx (plan 04 task 1)
- [ ] `src/__tests__/phase-149-my-strategies-parity.test.ts` — SC-3 gate + Rule-9 ledger (plan 05)
- [ ] Framework install: none — vitest + Playwright present
- [ ] NOT created (ruling): `StrategyGrid.test.tsx` extension — the rowLinkMode fix is out of scope; grid is unreachable on the owner surface instead (toggle hidden, pinned by gate pin 7)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Founder proof case: 8 active keys (bybit, okx, deribit ×3, mt5 ×3) → 4 ranked rows (Alpha Centauri via strategy_keys) + 2 placeholders, all opening factsheets | NAV-01 / SC-1d | PROD data; no DB access from CI | Authed PROD as founder (authed-prod runbook / role='both' account): open /my-strategies, count 4 ranked + 2 placeholder rows, click one private row → factsheet 200, anon same URL → 404 |
| Percentile threshold copy on PROD (published population may be <5) | SC-2c | live population unknown (RESEARCH Open Q3) | If the threshold copy renders, that is HONEST, not broken — brief the founder before UAT |
| Owner-draft factsheet UAT freshness | SC-5 | 148 Lane A `unstable_cache` survives deploys | Use a FRESH draft id or `revalidateTag` per 148's Manual-Only note |

---

## Falsifiability Ledger

> One row per ROADMAP success criterion. Mutations are semantic edits to PRODUCTION source;
> second-member sites preferred (mutate the site the author did not have in mind).

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 (own coverage) | `queries.ts::getMyStrategies`: `.eq("user_id", userId)` → `withPublishedOrOwner(query, userId)` | gate pin 4 + `page.test.tsx` SC-1b chain assertion | ⬜ pending | |
| SC-1b (per-KEY coverage, second member) | `queries.ts::deriveStrategylessKeys`: drop `...linkedKeyIds` from the covered Set | `queries.my-strategies.test.ts` Alpha Centauri case (5 ≠ 2) | ⬜ pending | |
| SC-2 (parity) | `StrategyTable.tsx` owner arm: `strategies.slice()` → `strategies.filter((s) => s.status !== "draft")` | `StrategyTable.visibility.test.tsx` SC-1c (draft row missing) | ⬜ pending | |
| SC-3 (structural, member A) | delete `= "published-only"` from the StrategyTable destructuring | gate pin 1; record whether the behavioral spec also reds (asymmetry note) | ⬜ pending | |
| SC-3 (structural, second member) | add `visibility="owner-all-statuses"` to `src/app/browse/[slug]/page.tsx` (the BROWSE call site, not discovery) | gate pins 2 + 9 | ⬜ pending | |
| SC-3 (percentile pin) | `queries.ts::getPercentiles` un-scoped branch: remove the `withPublishedOnly(` wrapper | gate pin 5 | ⬜ pending | |
| SC-4 (honest pending) | `StrategyTable.tsx` chip gate: `visibility === "owner-all-statuses" && !s.analytics.computed_at` → `false` | `StrategyTable.pending-chip.test.tsx` Syncing case | ⬜ pending | |
| SC-5 (no dead-end) | `StrategyTable.tsx`: `effectiveViewMode` guard → plain `viewMode` (grid reachable again) | gate pin 7 + visibility spec toggle-hide case | ⬜ pending | |

*Rules: Observed means run — paste the failing assertion. A skipped mutation is recorded skipped,
never caught. Reverts by re-editing the mutated line, never `git checkout --`; `git diff --quiet`
on the file must exit 0 after revert.*

---

## Oracle Independence

- [x] No test imports a **constant** from the module it tests — expected values (column labels, copy strings, chip classes, `P82`, `/factsheet/{id}`) are literals typed into the tests
- [x] No assertion compares a value to itself via a re-export — N in page.test comes from a 7-id fixture map, asserted as the literal `7`
- [x] Table/registry sizes pinned to literal counts (2 placeholders, 8 SURFACES, exactly-one widening consumer)
- [x] Doubles pinned against real contracts: the supabase double records the `.from/.select/.eq` chain (predicate observable); `ContributionWizardOverlay` mocked against its exact `{isOpen,onClose,onSuccess?}` interface

Deliberate self-references: none. (The structural gate reads production SOURCE as its subject —
that is its job, not an oracle leak; its own falsifiability is covered by the mutation campaign.)

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`vitest run` everywhere)
- [x] Feedback latency < 300 s
- [x] **Every success criterion has a Falsifiability Ledger row**
- [ ] **Every ledger row is `Observed ✅` with pasted evidence** (execution-time — plan 05 task 2)
- [x] **Oracle Independence checklist complete**
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (execution-time completion by plan 149-05)
