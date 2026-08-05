---
phase: 148
slug: own-owner-factsheet-without-cache-disclosure
status: executed
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-05
planned: 2026-08-05
executed: 2026-08-05
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
| **Full suite command** | `npm run test:coverage && npm run typecheck && npm run lint` — ⚠️ corrected at execution (148-05-03): plain `npm test` runs WITHOUT `--coverage` and therefore proves nothing about the blocking 82/80/74/72 gate. The phase-final gate was run with `test:coverage`. |
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
| 148-01-01 | 01 | 1 | OWN-02 | T-148-05 | lane state never enters the cached payload; banner default-off | component unit (tdd) | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx" --no-file-parallelism` | ✅ created in-task | ✅ green (4/4; RED-first observed in 148-01) |
| 148-01-02 | 01 | 1 | OWN-02 | T-148-05b | published render byte-identical (GUARD-02) | component unit (existing, PERMANENT) | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx" "src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx" --no-file-parallelism && npm run typecheck && npm run lint` | ✅ exists | ✅ green (10/10 across 2 files; GUARD-02 file zero-diff; typecheck 0, lint 0 errors) |
| 148-02-01 | 02 | 1 | OWN-02 | T-148-02 / T-148-07 | visibility REQUIRED param (omission = compile error); cached wrapper visibility-free; force-dynamic pin | typecheck + existing units | `npm run typecheck && npx vitest run "src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx" src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism` | ✅ exists | ✅ green (typecheck 0 — the required param reached its only call site; 2 files / 14 tests) |
| 148-02-02 | 02 | 1 | OWN-02 | — | staleness finding logged, not fixed (blast-radius bar) | lint + grep | `npm run lint && grep -c "factsheet-v2-payload-v6" TODOS.md` | ✅ exists | ✅ green (lint 0 errors; `factsheet-v2-payload-v6` count 2 in TODOS.md → DEF-148-A present) |
| 148-03-01 | 03 | 2 | OWN-02 | T-148-01/02/04 | RED spec: spy-counted cache, session-keyed predicate, uniform 404 | page-level RSC unit (RED) | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" --no-file-parallelism; test $? -ne 0` | ✅ created in-task | ✅ green (RED observed: 7 failed \| 3 passed — tests 2/7/10 green by design) |
| 148-03-02 | 03 | 2 | OWN-02 | T-148-01/02/03/04 | owner lane uncached; anon/non-owner 404; mock extended SAME commit | page-level RSC unit (GREEN) | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" "src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx" src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism && npm run typecheck && npm run lint` | ✅ after 03-01 | ✅ green (owner-lane 10/10, smoothed-wiring 2/2, 147 guards 12/12, typecheck 0, lint 0 errors) |
| 148-03-03 | 03 | 2 | OWN-02 | T-148-01/02/04 | falsifiability: SC-1 / SC-2A / SC-4 mutations observed RED | mutation runs | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" "src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx" --no-file-parallelism && git diff --quiet -- "src/app/factsheet/[id]/v2/page.tsx"` | ✅ after 03-01 | ✅ green (3/3 mutations observed RED and reverted; `git diff --quiet` exit 0 on page.tsx) |
| 148-04-01 | 04 | 3 | OWN-02 | T-148-01/02/03/07 | SC2-B structural CI invariant (147-guards clone, anti-vacuous) | source-scan unit | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts --no-file-parallelism` | ✅ created in-task | ✅ green (9/9; typecheck 0, lint 0) |
| 148-04-02 | 04 | 3 | OWN-02 | T-148-01/02 | falsifiability: SC-2B mutations at TWO sites observed RED | mutation runs | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" --no-file-parallelism && git diff --quiet -- "src/app/factsheet/[id]/v2/page.tsx" && npm run typecheck` | ✅ after 04-01 | ✅ green (SC-2B-a 2 red + behaviour-file asymmetry recorded; SC-2B-b 3 red at the SIGNATURE site with tsc 0; both reverted, `git diff --quiet` exit 0) |
| 148-05-01 | 05 | 4 | OWN-04 | T-148-06 | RED spec: link both branches, structurally absent pre-success | component unit (RED) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx" --no-file-parallelism; test $? -ne 0` | ✅ created in-task | ✅ green (RED observed: 5 failed \| 3 passed (8) — all five presence pins red, the absence trio green by design) |
| 148-05-02 | 05 | 4 | OWN-04 | T-148-06/06b | one component two sites; rel="noopener noreferrer"; no disabled variant | component unit (GREEN) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx" "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.render.test.tsx" "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx" --no-file-parallelism && npm run typecheck && npm run lint` | ✅ after 05-01 | ✅ green (3 files / 95 tests; both frozen siblings UNMODIFIED — empty `git diff --stat`; typecheck 0, lint 0 errors) |
| 148-05-03 | 05 | 4 | OWN-02, OWN-04 | all | phase gate + SC-3 mutation + sign-off | full suite | `npm run test:coverage && npm run typecheck && npm run lint && git diff --quiet -- "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx"` | ✅ exists | ✅ green (744 files / **10697 passed**, 287 skipped; coverage lines 87.85 / stmts 85.73 / funcs 82.61 / branches 80.07 — all above the 82/80/74/72 blocking gate; typecheck 0; lint 0 errors; `git diff --quiet` exit 0) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Each new test file is created RED-first inside its own plan (test and implementation are
adjacent tasks in the same plan, so no cross-plan test-scaffold dependency exists):

- [x] `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` — plan 148-01 task 1 (RED before impl in the same task). **Done:** commit `e44adcb7` (RED) → `1f299df9` (GREEN), 4 tests.
- [x] `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx` — plan 148-03 task 1 (RED task precedes impl task). ⛔ `unstable_cache` must be a SPY `vi.fn((fn) => fn)`, never a bare identity stub (Pitfall 5); `@/lib/visibility` via `vi.importActual` + spread (option (a), R8-style). **Done:** commit `167add4b`, 10 tests, both harness properties present.
- [x] `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` — plan 148-04 task 1 (green against shipped code; falsifiability proven by task 2 mutations). **Done:** commit `26cc391a`, 9 assertions incl. the anti-vacuity check.
- [x] `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx` — plan 148-05 task 1 (RED task precedes impl task; third sibling file — the two existing render test files stay FROZEN). **Done:** commit `c1cb19f8` (RED, 5 failed | 3 passed) → `1679f761` (GREEN). Both frozen siblings verified UNMODIFIED (`git diff --stat` empty) at the GREEN commit.
- [x] **Edit** `src/app/factsheet/[id]/v2/page.smoothed-wiring.test.tsx` `@/lib/visibility` factory — plan 148-03 task 2, SAME COMMIT as the page import (guaranteed break otherwise — research finding 6). **Done:** `withPublishedOrOwner: (qb: unknown) => qb` added in commit `d96ce41e`, the same commit that adds the page's import.
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
| SC-1 | `page.tsx` Lane B probe: `withPublishedOrOwner(q…, user.id)` → `withPublishedOnly(q…)` | `page.owner-lane.test.tsx` tests 1 & 9 (owner render notFounds; predicate literal missing) | ✅ **Observed** (148-03-03, 2026-08-05) | `Tests 7 failed \| 3 passed (10)` — test 1: `Error: notFound() called ❯ Module.FactsheetV2Page src/app/factsheet/[id]/v2/page.tsx` (the owner is 404'd by their own draft); test 9: same `notFound()` throw, no `.or` filter ever recorded. Tests 3/4/5/6/8 red as collateral (every owner-lane path depends on the probe). |
| SC-2A | `page.tsx` owner payload arm: `fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, uid))` → `buildFactsheetPayloadCached(\`${id}::${computedAt}\`)` | `page.owner-lane.test.tsx` tests 4/5/6 (`unstable_cache` count-0 assertions) — this is the test-header neuter check | ✅ **Observed** (148-03-03, 2026-08-05) | `Tests 3 failed \| 7 passed (10)` — EXACTLY tests 4/5/6, no collateral. Test 4: `AssertionError: an owner render must never reach the shared, id-keyed cache: expected "vi.fn()" to be called +0 times, but got 1 times`. Test 6 (null-is-cached trap): `AssertionError: a null must never be offered to the shared cache from the owner lane: expected "vi.fn()" to be called +0 times, but got 1 times`. Recorded in the test file's neuter-check header. |
| SC-2B-a | `page.tsx` cached callback: `fetchAndBuildPayload(id, withPublishedOnly)` → `fetchAndBuildPayload(id, (q) => q)` (predicate dropped — unfiltered rows to anon) | `phase-148-owner-lane-cache-isolation.test.ts` assertion 2. ⚠️ Expected asymmetry: the behavior file does NOT catch this — record that observation; it is why the structural layer exists | ✅ **Observed** (148-04-02, 2026-08-05) | `Tests 2 failed \| 7 passed (9)` — `AssertionError: expected 'async () => fetchAndBuildPayload(id, …' to contain 'withPublishedOnly'` / `Received: "async () => fetchAndBuildPayload(id, (q) => q)"`, and `… to contain 'fetchAndBuildPayload(id, withPublishe…'` with the same Received. **ASYMMETRY CONFIRMED, not a miss:** under the identical mutation `page.owner-lane.test.tsx` stayed `Tests 10 passed (10)` — its supabase double does not apply the injected predicate, so no behavioural assertion can see the drop. The structural gate is the SOLE control for this edit. |
| SC-2B-b | **Second member of the class — the signature-gate site:** `buildFactsheetPayloadCached(cacheKey: string)` → `(cacheKey: string, visibility: StrategyVisibility)` with `visibility` threaded into the callback (typecheck stays green) | `phase-148-owner-lane-cache-isolation.test.ts` assertions 2 & 3 | ✅ **Observed** (148-04-02, 2026-08-05) | `Tests 3 failed \| 6 passed (9)` with `npm run typecheck` still at **0 errors** — the type system cannot object once the seam is re-opened. Assertion 3: `AssertionError: expected 'function buildFactsheetPayloadCached(…' not to contain 'visibility'` / `+ function buildFactsheetPayloadCached(\n+   cacheKey: string,\n+   visibility: StrategyVisibility,\n+ ): Promise<FactsheetPayload \| null>`. Assertion 2 both halves red: `Received: "async () => fetchAndBuildPayload(id, visibility)"`. Reverted by re-editing all three mutated lines; `git diff --quiet -- page.tsx` exit 0. |
| SC-3 | **Second member — the composite site:** delete the `ViewFullFactsheetLink` usage from the composite branch ONLY (single-key stays) | `SyncPreviewStep.own04-link.test.tsx` composite test RED while single-key test GREEN (proves per-site coverage) | ✅ **Observed** (148-05-03, 2026-08-05) | `Tests 2 failed \| 6 passed (8)` — **exactly** the two composite tests, zero collateral: `TestingLibraryElementError: Unable to find an element by: [data-testid="wizard-view-full-factsheet"]` on both *"composite passed: renders the SAME element with the same copy and its own strategyId"* and *"composite passed: exactly ONE link node exists (no duplicate paste)"*. All three single-key presence tests and all three structural-absence tests stayed **green**, which is the point of the mutation: the coverage is genuinely PER-SITE, not one shared assertion that a single site could satisfy for both. Reverted by re-editing the deleted line; `git diff --quiet -- SyncPreviewStep.tsx` exit 0. |
| SC-4 | `page.tsx` Lane B probe second argument: `user.id` → `id` (param-keyed instead of session-keyed) | `page.owner-lane.test.tsx` test 9 (R8-style predicate-literal `user_id.eq.<session-uuid>` no longer matches) | ✅ **Observed** (148-03-03, 2026-08-05) | `Tests 2 failed \| 8 passed (10)` — test 9: `AssertionError: expected 'status.eq.published,user_id.eq.444444…' to be 'status.eq.published,user_id.eq.111111…' // Object.is equality`. The mutated predicate names the **strategy id** (`4444…`), not the session uuid (`1111…`) — the param-keyed leak made visible. Test 8 red too (it pins the same literal for a second, non-owner session). |

*Rules:*
- **Observed means run.** Paste the failing assertion into Evidence.
- **A skipped mutation is recorded as skipped, never as caught.**
- **Second-member preference applied:** SC-2B-b mutates the signature-gate site (not the
  payload-build site again); SC-3 mutates the composite site (the one an author forgets).

---

## Oracle Independence

- [x] No test imports a **constant** from the module it tests — UI-SPEC copy strings, the
      `status.eq.published,user_id.eq.<uuid>` predicate string, hrefs, and cache call-counts
      (0 / 1) are all literals typed into the test files (mandated in every plan's acceptance criteria).
      **Re-confirmed 148-05-03:** `SyncPreviewStep.own04-link.test.tsx` imports exactly ONE symbol
      from its subject — the `SyncPreviewStep` component itself. Every oracle
      (`wizard-view-full-factsheet`, `View full factsheet →`, the caption sentence,
      `/factsheet/strat-1/v2`, `/factsheet/composite-strat-1/v2`, `noopener noreferrer`, `_blank`)
      is a literal declared at the top of the test file. The SC-3 mutation confirms this
      operationally: deleting one usage moved the code but NOT the expectations.
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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — **12/12 automated at plan time; 12/12 run and green at execution**
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — **holds (every task verified)**
- [x] Wave 0 covers all MISSING references — **holds (4 new files, each created RED-first in its own plan; all 4 boxes now ticked above)**
- [x] No watch-mode flags — **holds (`vitest run` everywhere; the phase gate used `npm run test:coverage`, which is `vitest run --coverage`)**
- [x] Feedback latency < 300 s — **holds (targeted battery 4.25 s; full coverage suite 133 s)**
- [x] **Every success criterion has a Falsifiability Ledger row** — SC-1, SC-2A, SC-2B-a/b, SC-3, SC-4 ✔
- [x] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly skipped-with-reason** — 6/6 observed; **zero skipped**. SC-1/SC-2A/SC-4 at 148-03-03, SC-2B-a/b at 148-04-02, SC-3 at 148-05-03.
- [x] **Oracle Independence checklist complete** — re-confirmed at 148-05-03 (see the added note above)
- [x] `nyquist_compliant: true` set in frontmatter

### Phase-final gate (148-05-03, 2026-08-05)

| Gate | Command | Result |
|------|---------|--------|
| Full suite + **blocking coverage thresholds** | `npm run test:coverage` | 744 files passed, 19 skipped (763); **10697 tests passed**, 287 skipped (10984). Coverage: **lines 87.85 · statements 85.73 · functions 82.61 · branches 80.07** — all clear of the 82/80/74/72 gate. |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | **0 errors**, 1 pre-existing warning in the untouched `allocations/widgets/performance/EquityChart.tsx:1119` (`react-hooks/exhaustive-deps`) |
| Targeted battery (GUARD-02, 147 guards, 148 cache isolation, owner lane, smoothed wiring, owner notice, own04 link) | `npx vitest run <7 files> --no-file-parallelism` | 7 files / 51 tests passed |
| Production source unchanged after mutations | `git diff --quiet -- ".../SyncPreviewStep.tsx"` | exit 0 |

⚠️ The gate caught one real defect en route: the new link's doc-comment carried two bare
`file.ext:NN` citations, which `seam-citations.invariant.test.ts` (SEAMPROSE-01) rejects on the
ratified seam surface. Fixed to symbol-anchored references in commit `18d35476` before the
gate was re-run clean. This is exactly what that invariant exists for.

### SC-4 — "publication remains admin-only": satisfied by ABSENCE

The clause is discharged by the phase diff containing **zero writes**, not by a new test:

- `git diff f713cf97..HEAD -- src | grep '^+' | grep -E '\.insert\(|\.update\(|\.upsert\(|\.delete\('`
  returns exactly **one** line — `lsStore.delete(k)` — which is an in-memory `Map` teardown in a
  *test* file's `localStorage` stub (`FactsheetView.owner-notice.test.tsx`), not a database write.
  Database write additions: **0**.
- `git diff f713cf97..HEAD -- supabase/` is **empty**: the publish-transition trigger
  `20260716131000_guard_strategies_publish_transition.sql` is unmodified and still blocks
  `authenticated → published`.
- The phase adds one new auth path only (`supabase.auth.getUser()` on the published-miss branch),
  which is a read.

**Approval:** ✅ approved — 2026-08-05, stamped by plan 148-05 task 3 after the phase-final gate.
All 4 ROADMAP success criteria hold with observed falsifiability evidence; no ledger row is
pending or skipped.
