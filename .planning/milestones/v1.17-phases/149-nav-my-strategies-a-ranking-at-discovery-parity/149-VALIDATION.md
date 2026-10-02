---
phase: 149
slug: nav-my-strategies-a-ranking-at-discovery-parity
status: executed
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-05
planned: 2026-08-05
executed: 2026-08-05
---

# Phase 149 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sources: 149-RESEARCH.md §Validation Architecture (per-SC test map), 149-PATTERNS.md §9/§11,
> orchestrator/founder rulings 2026-08-05 (own-only predicate, toggle-hide, placeholder census,
> scorer extraction — checker B-4; archived ≠ coverage — checker W-4).

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
| 149-01-01 | 01 | 1 | NAV-01 | T-149-01 | default drops unpublished rows; owner recipe renders them | component unit (RED-first) | `npx vitest run src/components/strategy/StrategyTable.visibility.test.tsx --no-file-parallelism` | ❌ W0 (created by task) | ✅ green |
| 149-01-02 | 01 | 1 | NAV-01 | T-149-01/02/03 | literal default; grid unreachable; Simulate published-gated | same + existing 912-line suite untouched | `npx vitest run src/components/strategy/StrategyTable.visibility.test.tsx src/components/strategy/StrategyTable.test.tsx --no-file-parallelism` | ✅ after 01-01 | ✅ green |
| 149-02-01 | 02 | 1 | NAV-01 | T-149-04/05 | own-only predicate (archived excluded); census-correct anti-join (strategy_keys covered, archived ≠ coverage); analyticsPresent signal preserved | pure-fn unit + gate regression | `npx vitest run src/lib/queries.my-strategies.test.ts src/lib/queries.percentiles.test.ts src/__tests__/phase-147-series-resolution-guards.test.ts src/__tests__/phase-84-asset-class-flow.test.ts src/__tests__/phase-63-series-space-guards.test.ts --no-file-parallelism && npx tsc --noEmit` | ❌ W0 | ✅ green |
| 149-02-02 | 02 | 1 | NAV-01 | T-149-06 | ONE scoring core; getPercentiles byte-behavior preserved (untouched oracle); own rows never enter the population | pure-fn unit + existing oracle | `npx vitest run src/lib/percentile-core.test.ts src/lib/queries.percentiles.test.ts --no-file-parallelism && npx tsc --noEmit` | ❌ W0 (core spec) / ✅ oracle exists | ✅ green |
| 149-02-03 | 02 | 1 | NAV-01 | — | `private` → muted `Private`, fallback contract preserved | component unit (RED-first) | `npx vitest run src/components/ui/Badge.test.tsx --no-file-parallelism` | ❌ W0 | ✅ green |
| 149-03-01 | 03 | 2 | NAV-01 | T-149-09/10 | chips owner-gated on NO-COMPUTED-METRICS (never !computed_at); analyticsPresent coerced (no forever-spinner; omitted ≠ false — W-C); never 0.00/+0.0%; muted/amber only; no "Synced" beside a chip (W-B) | component unit (RED-first) | `npx vitest run src/components/strategy/StrategyTable.pending-chip.test.tsx --no-file-parallelism && npx tsc --noEmit` | ❌ W0 | ✅ green |
| 149-03-02 | 03 | 2 | NAV-01 | T-149-08 | placeholders outside #n (13-td anatomy == header th count), absent on public, below the filter-empty message, button not a /strategies link | component unit (RED-first) | same file + tsc | ✅ after 03-01 | ✅ green |
| 149-04-01 | 04 | 3 | NAV-01 | T-149-11/12/14/15 | `.eq("user_id", uid)` + `.neq("status","archived")` chain-recorded; noStore; real N (populationSize — I-2 single fetch); own-row P100 via scorer (self-inclusive, W-A); allocator literal | RSC page unit + lint | `npx vitest run "src/app/(dashboard)/my-strategies/page.test.tsx" "src/app/(dashboard)/requireRolePage-wiring.test.tsx" --no-file-parallelism && npm run lint` | ❌ W0 | ✅ green |
| 149-04-02 | 04 | 3 | NAV-01 | T-149-13 | entry allocator-branch-only; `<a href="/my-strategies">`; manager negative | component unit + frozen-spine gate | `npx vitest run src/components/layout/Sidebar.test.tsx src/__tests__/phase-32-frozen-spine-guards.test.ts --no-file-parallelism` | ✅ EXTEND | ✅ green |
| 149-05-01 | 05 | 4 | NAV-01 | T-149-16/17 | 12 structural pins incl. the withPublishedOnly COUNT, the single scoring core, and anti-vacuity | source-scan unit | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts --no-file-parallelism` | ❌ W0 | ✅ green |
| 149-05-02 | 05 | 4 | NAV-01 | T-149-18 | ≥4 observed-RED mutations; phase gate; public e2e invariance | mutation runs + full suite | `npm run test:coverage && npm run typecheck && npm run lint` + 148 pair + 2 e2e specs | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Created inside the plans that consume them (test-first task ordering; every code task is preceded
or accompanied by its RED-first spec in the same plan):

- [x] `src/components/strategy/StrategyTable.visibility.test.tsx` — SC-1c/2a/2b/4c/5a + toggle-hide + Simulate gate (plan 01 task 1; ⛔ MUST be observed RED against today's `StrategyTable.tsx:331`)
- [x] `src/lib/queries.my-strategies.test.ts` — pure anti-join falsifier incl. the Alpha Centauri strategy_keys case + BOTH archived-≠-coverage cases with `"archived"` literals (plan 02 task 1)
- [x] `src/lib/percentile-core.test.ts` — self-inclusion (P63 pin, W-A) / identity-dedupe parity / inversion / magnitude / mixed-metric map-shape (W-D) / own-never-shifts-others falsifiers (plan 02 task 2)
- [x] **Oracle (exists, ZERO edits):** `src/lib/queries.percentiles.test.ts` — the getPercentiles byte-behavior oracle through the core extraction; a diff on this file during plan 02 is a plan violation
- [x] `src/components/ui/Badge.test.tsx` — SC-4b (plan 02 task 3; file confirmed absent by pattern mapper)
- [x] `src/components/strategy/StrategyTable.pending-chip.test.tsx` — SC-4a/4b over REAL pipeline states (job-running with computed_at set; never-enqueued absent-row young/old; failed) + Delta-5 placeholders (plan 03)
- [x] `src/app/(dashboard)/my-strategies/page.test.tsx` — SC-1b/2c/2d; ⛔ chain-recording supabase double recording `.neq` alongside `.eq` and routing payloads by QUERY SHAPE (own `*` select vs population select — I-3), never an identity stub (148 Pitfall-5 lesson) (plan 04 task 1)
- [x] **Edit** `src/components/layout/Sidebar.test.tsx` — SC-1a role matrix (plan 04 task 2)
- [x] **Edit** `src/app/(dashboard)/requireRolePage-wiring.test.tsx` — GATE-a 8th SURFACES entry, same commit as page.tsx (plan 04 task 1)
- [x] `src/__tests__/phase-149-my-strategies-parity.test.ts` — SC-3 gate + Rule-9 ledger (plan 05)
- [x] Framework install: none — vitest + Playwright present
- [x] NOT created (ruling): `StrategyGrid.test.tsx` extension — the rowLinkMode fix is out of scope; grid is unreachable on the owner surface instead (toggle hidden, pinned by gate pin 7)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| **Founder proof case (SC-1's proof — checker W-3 ruling: NO in-phase checkpoint; discharged by POST-MERGE PROD UAT, and plan 05's SUMMARY must state this discharge):** founder account, 8 active keys (bybit, okx, deribit ×3, mt5 ×3) → 4 ranked+SCORED rows (each carrying Pnn against the published population — the scorer ruling; Alpha Centauri via strategy_keys) + 2 placeholders, all ranked rows opening factsheets. Counts assume the W-4 archived ruling: archived rows excluded from the ranked list; a key covered ONLY by an archived strategy is placeholder-eligible | NAV-01 / SC-1d | PROD data; no DB access from CI | Authed PROD as founder (authed-prod runbook / role='both' account): open /my-strategies, count 4 ranked (Pnn suffixes present when population ≥5) + 2 placeholder rows, click one private row → factsheet 200, anon same URL → 404 |
| Percentile threshold copy on PROD (published population may be <5) | SC-2c | live population unknown (RESEARCH Open Q3) | If the threshold copy renders, that is HONEST, not broken — brief the founder before UAT. Note: getOwnRowPercentiles mirrors the <5 thresholds, so Pnn absence and the threshold copy flip together |
| Owner-draft factsheet UAT freshness | SC-5 | 148 Lane A `unstable_cache` survives deploys | Use a FRESH draft id or `revalidateTag` per 148's Manual-Only note |
| **⚠️ EXPECTED Pnn delta vs /discovery (review WR-02 — NOT a scorer bug):** /my-strategies scores against the GLOBAL published universe (unscoped `getPercentiles()`), /discovery/[slug] against the CATEGORY-scoped one — a published own row will generally show a DIFFERENT Pnn on the two surfaces. Deliberate (RESEARCH ruling; the surface label "ranked against N published strategies" states the global set). UAT must not read the delta as a defect | NAV-01 | Cross-surface comparison needs live data | Compare one published row's Pnn on both surfaces; confirm the on-page population label N matches the global count, and the delta is explainable by category-vs-global population |

---

## Falsifiability Ledger

> One row per ROADMAP success criterion (members split where the checker required a second
> mutation). Mutations are semantic edits to PRODUCTION source; second-member sites preferred
> (mutate the site the author did not have in mind).

All twelve rows were RUN on 2026-08-05 during plan 149-05 task 2 (nine mutations; three rows are
covered by mutations run in earlier plans and are marked with their provenance). Every mutation was
reverted by RE-EDITING the mutated line — never `git checkout --` — and `git diff --quiet` on each
mutated file exits 0. Full pasted failure output lives in the header of
`src/__tests__/phase-149-my-strategies-parity.test.ts` (M1–M9).

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 (own coverage) | `queries.ts::getMyStrategies`: `.eq("user_id", userId)` → `withPublishedOrOwner(query, userId)` | gate pin 4 + `page.test.tsx` SC-1b chain assertion | ✅ Observed (M3) | gate pin 4: `AssertionError: expected '\n  const supabase = await createClie…' to contain '.eq("user_id"'` (1 failed \| 12 passed). `page.test.tsx` 9 failed / 9 — recorded HONESTLY: it reds on the CHAIN SHAPE (`TypeError: query.or is not a function`, visibility.ts:122 via queries.ts:293), because its recording double implements `.from/.select/.eq/.neq` but not `.or`. A double that DID implement `.or` would leave the widened predicate behaviourally invisible; the gate would still catch it. |
| SC-1b (per-KEY coverage, second member) | `queries.ts::deriveStrategylessKeys`: drop the linked-keys union from the covered Set | `queries.my-strategies.test.ts` Alpha Centauri case (5 ≠ 2) | ✅ Observed (M5) | 3 failed / 6 passed. Founder census case: `AssertionError: expected [ 'k4', 'k5', 'k6', 'k7', 'k8' ] to deeply equal [ 'k7', 'k8' ]` — exactly the 3 spurious placeholders the composite would fabricate. Also red: the archived-composite case and the double-linked-key case. |
| SC-1c (archived ≠ coverage — W-4) | `queries.ts::deriveStrategylessKeys`: drop the `status !== "archived"` filter (archived counts as coverage again) | `queries.my-strategies.test.ts` BOTH archived cases (direct + strategy_keys-linked) | ✅ Observed in plan 149-02 (RED-first) | The whole spec was written RED-first against a non-existent `deriveStrategylessKeys` (`TypeError: deriveStrategylessKeys is not a function`, 9 failed / 9 — 149-02-SUMMARY "Observed RED outputs"), so both archived cases were watched failing before the filter existed. Each carries an otherwise-identical `"private"` control so it cannot pass by ignoring status. NOT re-run as a standalone mutation in 149-05 — recorded as covered by the RED-first observation, not claimed as a second campaign row. |
| SC-2 (parity) | `StrategyTable.tsx` owner arm: `strategies.slice()` → `strategies.filter((s) => s.status !== "draft")` | `StrategyTable.visibility.test.tsx` SC-1c (draft row missing) | ✅ Observed in plan 149-01 (RED-first) | The owner-arm case was watched failing against the unmodified component: `× visibility='owner-all-statuses' renders private, draft AND published rows` (6 failed / 6 passed — 149-01-SUMMARY). The failure mode was the strongest possible form of this mutation — the owner arm did not exist at all, so every draft row was dropped. NOT re-run in 149-05. |
| SC-2d (own Pnn — scorer core inversion, checker B-4) | `percentile-core.ts`: flip the inversion arm `100 - percentile` → `percentile` | BOTH callers' tests: `queries.percentiles.test.ts` (:74-80 best=80/worst=0 pin) AND `percentile-core.test.ts` (inversion case) | ✅ Observed (M7) | 2 files failed, 4 failed / 6 passed — BOTH callers, which is the "one core, two callers" property made observable. `percentile-core.test.ts`: `expected 33 to be 67`; `expected { cagr: 67, max_drawdown: 50, …(1) } to deeply equal { cagr: 67, volatility: 67, …(1) }`. `queries.percentiles.test.ts`: `expected 20 to be greater than 100` (×2, the drawdown and volatility inversion pins). |
| SC-3 (structural, member A) | delete `= "published-only"` from the StrategyTable destructuring | gate pin 1; record whether the behavioral spec also reds (asymmetry note) | ✅ Observed (M1) | gate pin 1: `AssertionError: expected '"use client";…' to contain 'visibility = "published-only"'` (1 failed \| 12 passed). ASYMMETRY NOTE: `StrategyTable.visibility.test.tsx` ALSO reds (1 failed \| 11 passed) — "the DEFAULT recipe (no visibility prop) still drops every non-published row", with `Private Nebula` rendering as a real `<a href="/factsheet/…">`. Both layers catch M1; they diverge at M2/M6/M9. |
| SC-3 (structural, second member) | add `visibility="owner-all-statuses"` to `src/app/browse/[slug]/page.tsx` (the BROWSE call site, not discovery) | gate pins 2 + 10 | ✅ Observed (M2) | 2 failed / 11 passed. pin 2: `AssertionError: expected 'import Link from "next/link";\nimport…' not to contain 'visibility='`. pin 10: `AssertionError: expected [ …(2) ] to have a length of 1 but got 2`. **MEASURED ASYMMETRY — the load-bearing one:** the whole behavioural table suite stayed GREEN under the same edit (StrategyTable.visibility + pending-chip + StrategyTable.test = 61 passed / 61). No behavioural spec mounts the browse RSC, so the gate is the SOLE control for an edit whose blast radius is every anonymous /browse visitor. |
| SC-3 (percentile pin — checker B-3) | `queries.ts::getPercentiles` UN-SCOPED branch: remove the `withPublishedOnly(` wrapper | gate pin 5 (occurrence count 2 → 1 — genuinely caught; the old presence check was blind to this exact mutation) | ✅ Observed (M4) | gate pin 5: `AssertionError: expected 1 to be 2 // Object.is equality` (1 failed \| 12 passed). The count of 1 is itself the proof that a presence check (`toContain`) would have stayed green — the scoped branch's surviving occurrence keeps it satisfied. Everything else stayed green: `queries.percentiles.test.ts` + `percentile-core.test.ts` + `visibility.test.ts` = 17 passed / 17, INCLUDING the B10 raw-predicate sweep (the mutation removes a wrapper without introducing a raw `.eq`). |
| SC-4 (honest pending — B-1 coercion, re-derived) | `StrategyTable.tsx` chip derivation: drop the `analyticsPresent` coercion — pass `s.analytics.computation_status ?? null` unconditionally | `StrategyTable.pending-chip.test.tsx` never-enqueued-≥16h case (`No data` expected; the mutant renders EMPTY_ANALYTICS's hardcoded "pending" as a permanent `Syncing`) | ✅ Observed (M8) | 1 failed / 17 passed. `× shows 'No data' for a NEVER-ENQUEUED row PAST the 16h window (the B-1 falsifier)` — `AssertionError: expected <span …(3)></span> to be null`, received `<span aria-label="Syncing — first metrics arrive in ~10–15 min" class="… text-warning bg-warning-bg …">Syncing</span>`. The permanent-spinner defect resurrects verbatim. |
| SC-5 (no dead-end, member A — I-1 precise site) | `StrategyTable.tsx`: replace the `effectiveViewMode` DERIVATION expression `const effectiveViewMode = visibility === "owner-all-statuses" ? "table" : viewMode;` with `const effectiveViewMode = viewMode;` (grid reachable again) | gate pin 7 ONLY (the behavioral toggle-hide case does NOT see this — record the asymmetry) | ✅ Observed (M9) | gate pin 7: `AssertionError: expected '"use client";\n\nimport { useState, u…' to contain 'const effectiveViewMode = visibility …'` (1 failed \| 12 passed). ASYMMETRY CONFIRMED AS PREDICTED: the behavioural table suite stayed 61/61 GREEN — the toggle-hide case asserts the BUTTONS are absent, and the buttons hang off `showViewToggle` (M6's site), not off this derivation. For M9 the gate is the SOLE control against a stale persisted `view: "grid"` re-opening the dead end. |
| SC-5 (toggle wire, second member — checker W-6) | `StrategyTable.tsx`: `showViewToggle={visibility !== "owner-all-statuses"}` → `showViewToggle={true}` | `StrategyTable.visibility.test.tsx` toggle-hide case (`queryByLabelText("Grid view")` non-null) | ✅ Observed (M6) | 1 failed / 11 passed: `× hides BOTH view-toggle buttons under visibility='owner-all-statuses'` — `AssertionError: expected <button …(2)>…(1)</button> to be null`. The gate stayed 13/13 GREEN — recorded, not hidden: the toggle wire is an AFFORDANCE, the M9 derivation is the DEAD-END guard, and they are pinned by different layers on purpose. |

*Rules: Observed means run — paste the failing assertion. A skipped mutation is recorded skipped,
never caught. Reverts by re-editing the mutated line, never `git checkout --`; `git diff --quiet`
on the file must exit 0 after revert.*

---

## Oracle Independence

- [x] No test imports a **constant** from the module it tests — expected values (column labels, copy strings, chip classes, `P82`, `P100`, `/factsheet/{id}`, percentile literals 60/80) are hand-computed literals typed into the tests
- [x] No assertion compares a value to itself via a re-export — N in page.test comes from a 7-row population fixture, asserted as the literal `7`; the SC-2d `P100` is computed by hand from the sharpe fixture (self-inclusive per W-A: 8 of 8)
- [x] Table/registry sizes pinned to literal counts (2 placeholders, 13 tds == header th count, 8 SURFACES, exactly-one widening consumer, exactly-two withPublishedOnly occurrences)
- [x] Doubles pinned against real contracts: the supabase double records the `.from/.select/.eq/.neq` chain (predicate observable); `ContributionWizardOverlay` mocked against its exact `{isOpen,onClose,onSuccess?}` interface
- [x] `queries.percentiles.test.ts` serves as an INDEPENDENT pre-existing oracle for the core extraction (written before the refactor, zero edits allowed — it cannot have been shaped to the new code)

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
- [x] **Every ledger row is `Observed ✅` with pasted evidence** (execution-time — plan 05 task 2)
- [x] **Oracle Independence checklist complete**
- [x] `nyquist_compliant: true` set in frontmatter

### Execution-time gate results (149-05 task 2, 2026-08-05)

| Gate | Result |
|------|--------|
| `npm run test:coverage` | **751 files passed \| 19 skipped (770); 10778 tests passed \| 287 skipped (11065)** — statements 85.76 / branches 80.14 / functions 82.67 / lines 87.86, all above the blocking 82/80/74/72 thresholds |
| `npm run typecheck` | clean (`tsc --noEmit`, no output) |
| `npm run lint` | 0 errors, 1 pre-existing unrelated warning (`EquityChart.tsx:1119` exhaustive-deps); `check-admin-route-manifest` OK (20 routes); `check-route-contract` OK (57 page routes) |
| 148 regression pair (`page.owner-lane.test.tsx` + `phase-148-owner-lane-cache-isolation.test.ts`) | **20 passed / 20** (2 files) |
| `npx playwright test e2e/discovery.spec.ts e2e/discovery-prefs-isolation.spec.ts` | **1 passed, 1 skipped** — see the honest note below |
| mutation residue | `git status --short` clean of source edits; `grep -rn MUTANT src/` → 0 hits; `git diff --quiet` exits 0 on all four mutated production files |

**e2e honest note (a skip recorded as a skip, never as a pass).** `e2e/discovery.spec.ts`
("discovery category page redirects unauthenticated users") **passed** against a local dev server.
The whole `DISCO-02 allocator preferences isolation` describe block in
`e2e/discovery-prefs-isolation.spec.ts` is `test.skip`'d by a **pre-existing** env guard
(`discovery-prefs-isolation.spec.ts:143` — `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`
not wired locally, CI-skip per Plan 13-02 / 13-05). This is not a phase-149 regression and not a
phase-149 finding — it is the same skip CI takes without the seed secrets. The public-surface
invariance this phase actually claims is carried by gate pins 2 and 10 (structural, mutation-proved
by M2) plus the untouched 61-test behavioural table suite, not by that skipped spec.

**Approval:** ✅ approved — all in-phase rows discharged (2026-08-05, plan 149-05 task 2). The one
remaining obligation is the Manual-Only founder proof case above, which is discharged by
**post-merge PROD UAT** per the checker W-3 ruling: there is NO in-phase checkpoint task for it.
