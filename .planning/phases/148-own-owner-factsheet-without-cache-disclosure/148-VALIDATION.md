---
phase: 148
slug: own-owner-factsheet-without-cache-disclosure
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-05
planned: 2026-08-05
---

# Phase 148 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS suite, jsdom via file pragma) + Playwright (existing e2e, regression-only here) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <touched files> --no-file-parallelism` |
| **Full suite command** | `npm test && npm run typecheck && npm run lint` |
| **Estimated runtime** | ~300 s full · <30 s targeted |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <touched test files> --no-file-parallelism`
- **After every plan wave:** `npm test && npm run typecheck && npm run lint`
- **Before `/gsd:verify-work`:** full suite green + `npx playwright test e2e/mt5-badge.spec.ts e2e/composite-factsheet-render.spec.ts` (P126 badge class + factsheet render regression)
- **Max feedback latency:** 300 s (full), <30 s (targeted)
- ⚠️ CI = Node 22, local = Node 25 — a CI-only red reproduces with `PATH=/opt/homebrew/opt/node@22/bin`, it is skew not flake.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 148-01-01 | 01 | 1 | OWN-02 | T-148-05 | lane state never enters the cached payload; banner default-off | component unit (tdd) | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx" --no-file-parallelism` | ❌ W0 (created in-task, RED first) | ⬜ pending |
| 148-01-02 | 01 | 1 | OWN-02 | T-148-05b | published render byte-identical (GUARD-02) | component unit (existing, PERMANENT) | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx" "src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx" --no-file-parallelism && npm run typecheck && npm run lint` | ✅ exists | ⬜ pending |
| 148-02-01 | 02 | 1 | OWN-02 | T-148-02 / T-148-07 | visibility REQUIRED param (omission = compile error); cached wrapper visibility-free; force-dynamic pin | typecheck + existing units | `npm run typecheck && npx vitest run "src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx" src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism` | ✅ exists | ⬜ pending |
| 148-02-02 | 02 | 1 | OWN-02 | — | staleness finding logged, not fixed (blast-radius bar) | lint + grep | `npm run lint && grep -c "factsheet-v2-payload-v6" TODOS.md` | ✅ exists | ⬜ pending |
| 148-03-01 | 03 | 2 | OWN-02 | T-148-01/02/04 | RED spec: spy-counted cache, session-keyed predicate, uniform 404 | page-level RSC unit (RED) | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" --no-file-parallelism; test $? -ne 0` | ❌ W0 (created in-task) | ⬜ pending |
| 148-03-02 | 03 | 2 | OWN-02 | T-148-01/02/03/04 | owner lane uncached; anon/non-owner 404; mock extended SAME commit | page-level RSC unit (GREEN) | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" "src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx" src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism && npm run typecheck && npm run lint` | ✅ after 03-01 | ⬜ pending |
| 148-03-03 | 03 | 2 | OWN-02 | T-148-01/02/04 | falsifiability: SC-1 / SC-2A / SC-4 mutations observed RED | mutation runs | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" "src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx" --no-file-parallelism && git diff --quiet -- "src/app/factsheet/[id]/v2/page.tsx"` | ✅ after 03-01 | ⬜ pending |
| 148-04-01 | 04 | 3 | OWN-02 | T-148-01/02/03/07 | SC2-B structural CI invariant (147-guards clone, anti-vacuous) | source-scan unit | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts --no-file-parallelism` | ❌ W0 (created in-task) | ⬜ pending |
| 148-04-02 | 04 | 3 | OWN-02 | T-148-01/02 | falsifiability: SC-2B mutations at TWO sites observed RED | mutation runs | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" --no-file-parallelism && git diff --quiet -- "src/app/factsheet/[id]/v2/page.tsx" && npm run typecheck` | ✅ after 04-01 | ⬜ pending |
| 148-05-01 | 05 | 4 | OWN-04 | T-148-06 | RED spec: link both branches, structurally absent pre-success | component unit (RED) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx" --no-file-parallelism; test $? -ne 0` | ❌ W0 (created in-task) | ⬜ pending |
| 148-05-02 | 05 | 4 | OWN-04 | T-148-06/06b | one component two sites; rel="noopener noreferrer"; no disabled variant | component unit (GREEN) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx" "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.render.test.tsx" "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx" --no-file-parallelism && npm run typecheck && npm run lint` | ✅ after 05-01 | ⬜ pending |
| 148-05-03 | 05 | 4 | OWN-02, OWN-04 | all | phase gate + SC-3 mutation + sign-off | full suite | `npm test && npm run typecheck && npm run lint && git diff --quiet -- "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx"` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Each new test file is created RED-first inside its own plan (test and implementation are
adjacent tasks in the same plan, so no cross-plan test-scaffold dependency exists):

- [ ] `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` — plan 148-01 task 1 (RED before impl in the same task)
- [ ] `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` — plan 148-03 task 1 (RED task precedes impl task). ⛔ `unstable_cache` must be a SPY `vi.fn((fn) => fn)`, never a bare identity stub (Pitfall 5); `@/lib/visibility` via `vi.importActual` + spread (option (a), R8-style)
- [ ] `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` — plan 148-04 task 1 (green against shipped code; falsifiability proven by task 2 mutations)
- [ ] `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx` — plan 148-05 task 1 (RED task precedes impl task; third sibling file — the two existing render test files stay FROZEN)
- [ ] **Edit** `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` `@/lib/visibility` factory — plan 148-03 task 2, SAME COMMIT as the page import (guaranteed break otherwise — research finding 6)
- [x] Framework install: none needed — vitest/playwright/SQL harness all present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live two-request cache proof on a REAL Next data cache (owner GET draft → anon GET same id → 404) | OWN-02 SC2 | The vitest layer models the cache with a spy (RESEARCH Open Q1 — unit model of a cross-request property); CONTEXT locks unit+structural as the two acceptance layers, so this is a post-verify UAT spot-check, not a gate | On TEST/preview with an owner+draft pair YOU seeded: authed `curl` (magic-link session per the authed-prod-verification runbook) GET `/factsheet/<draft-id>/v2` → 200 with banner copy in HTML; then anon `curl` same URL → 404. ⚠️ Use a FRESH draft id or `revalidateTag` first — pre-existing cache entries survive deploys (Runtime State Inventory). Assert only on your own seeded id (shared-TEST-DB rule, PR #654) |
| Publication remains admin-only (SC4 clause) | OWN-02 SC4 | Satisfied by absence — the phase diff contains ZERO writes; DB trigger `20260716131000_guard_strategies_publish_transition.sql` blocks authenticated → published | Reviewer asserts: `git diff <phase-range>` shows no `.insert(`/`.update(`/`.upsert(` additions in touched files; trigger migration unmodified |

---

## Falsifiability Ledger

> **Coverage answers "is it verified?". This section answers "CAN the verification FAIL?"**

**One row per success criterion.** Mutations are *semantic* production edits, run at execution
time, reverted by re-editing the mutated line (never `git checkout --` with live ledgers).

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 | `page.tsx` Lane B probe: `withPublishedOrOwner(q…, user.id)` → `withPublishedOnly(q…)` | `page.owner-lane.test.tsx` tests 1 & 9 (owner render notFounds; predicate literal missing) | ⬜ pending (148-03-03) | |
| SC-2A | `page.tsx` owner payload arm: `fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, uid))` → `buildFactsheetPayloadCached(\`${id}::${computedAt}\`)` | `page.owner-lane.test.tsx` tests 4/5/6 (`unstable_cache` count-0 assertions) — this is the test-header neuter check | ⬜ pending (148-03-03) | |
| SC-2B-a | `page.tsx` cached callback: `fetchAndBuildPayload(id, withPublishedOnly)` → `fetchAndBuildPayload(id, (q) => q)` (predicate dropped — unfiltered rows to anon) | `phase-148-owner-lane-cache-isolation.test.ts` assertion 2. ⚠️ Expected asymmetry: the behavior file does NOT catch this — record that observation; it is why the structural layer exists | ⬜ pending (148-04-02) | |
| SC-2B-b | **Second member of the class — the signature-gate site:** `buildFactsheetPayloadCached(cacheKey: string)` → `(cacheKey: string, visibility: StrategyVisibility)` with `visibility` threaded into the callback (typecheck stays green) | `phase-148-owner-lane-cache-isolation.test.ts` assertions 2 & 3 | ⬜ pending (148-04-02) | |
| SC-3 | **Second member — the composite site:** delete the `ViewFullFactsheetLink` usage from the composite branch ONLY (single-key stays) | `SyncPreviewStep.own04-link.test.tsx` composite test RED while single-key test GREEN (proves per-site coverage) | ⬜ pending (148-05-03) | |
| SC-4 | `page.tsx` Lane B probe second argument: `user.id` → `id` (param-keyed instead of session-keyed) | `page.owner-lane.test.tsx` test 9 (R8-style predicate-literal `user_id.eq.<session-uuid>` no longer matches) | ⬜ pending (148-03-03) | |

*Rules:*
- **Observed means run.** Paste the failing assertion into Evidence.
- **A skipped mutation is recorded as skipped, never as caught.**
- **Second-member preference applied:** SC-2B-b mutates the signature-gate site (not the
  payload-build site again); SC-3 mutates the composite site (the one an author forgets).

---

## Oracle Independence

- [x] No test imports a **constant** from the module it tests — UI-SPEC copy strings, the
      `status.eq.published,user_id.eq.<uuid>` predicate string, hrefs, and cache call-counts
      (0 / 1) are all literals typed into the test files (mandated in every plan's acceptance criteria)
- [x] No assertion compares a value to itself via a re-export — the SC2-A oracle is the
      `unstable_cache` spy call-count, independent of the page's own code path; the SC2-B oracle
      reads source text against pinned literal tokens
- [x] Table/registry sizes pinned to literal counts — "exactly once" for `unstable_cache(`,
      literal test counts per file
- [x] Fakes pinned against real contracts — `@/lib/visibility` runs the REAL predicates via
      `vi.importActual` against a recording builder (option (a)); the `unstable_cache` spy
      preserves identity behavior `(fn) => fn` while counting

*Deliberate self-referential oracles:* none. The SC2 behavior test's oracle is the spy
call-count with literal expectations (0 owner / 1 public), never re-derived from the implementation.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies — **yes at plan time (12/12 automated)**
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify — **holds (every task verifies)**
- [ ] Wave 0 covers all MISSING references — **holds (4 new files each created RED-first in their own plan)**
- [ ] No watch-mode flags — **holds (`vitest run` everywhere)**
- [ ] Feedback latency < 300 s — **holds**
- [ ] **Every success criterion has a Falsifiability Ledger row** — SC-1, SC-2A, SC-2B-a/b, SC-3, SC-4 ✔
- [ ] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly skipped-with-reason** — completed by 148-03-03 / 148-04-02 / 148-05-03
- [ ] **Oracle Independence checklist complete** — designed-in above; re-confirm at 148-05-03
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending — stamped by plan 148-05 task 3 after the phase gate.
