---
phase: 152
slug: scen-composer-legibility
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-07
planned: 2026-08-07
completed: 2026-08-07
---

# Phase 152 — Validation Strategy

> Per-phase validation contract. Details in 152-RESEARCH.md `## Validation Architecture`;
> per-task map + falsifiability ledger filled by the planner (2026-08-07).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS only this phase) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <touched-test-file> --no-file-parallelism` |
| **Full suite command** | `npm test`; coverage gate `npm run test:coverage` (82/80/74/72, blocking) |
| **Estimated runtime** | quick ~10-30s; full ~5min |

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-T1 | 152-01 | 1 | SCEN-02/05 | T-152-01-01 | H-0300 fence: TWO exhaustive arms; third-party rows never carry created_at/status; whole-payload sweep | unit | `npx vitest run src/app/api/strategies/browse/route.test.ts -t "H-0300"` | ✅ extend | ✅ green (3 passed, re-observed 152-06 T3) |
| 01-T2 | 152-01 | 1 | SCEN-02/05 | T-152-01-02/03 | isOwn strict-boolean on every row; own-only conditional emission; user-scoped client untouched | unit | `npx vitest run src/app/api/strategies/browse/route.test.ts` | ✅ extend | ✅ green (31 passed, re-observed 152-06 T3) |
| 02-T1 | 152-02 | 1 | SCEN-02 | T-152-02-01 | populated-fixture strip guard (BOTH schemas); v4-without-isOwn decodes ok; isOwn:null never resets; version stays 4 | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-state.test.ts" -t "isOwn" --no-file-parallelism` | ✅ extend | ✅ green (4 passed, re-observed 152-06 T3) |
| 02-T2 | 152-02 | 1 | SCEN-02 | T-152-02-01 | `isOwn: z.boolean().nullish()` on the NESTED schema; no refine; no version bump; SC1 falsifier observed | unit | same as 02-T1 (full file) | ✅ green (SC1 observed, see ledger) |
| 03-T1 | 152-03 | 1 | SCEN-04 | T-152-03-02 | header renders iff ≥1 added row, exactly once, aria-hidden, exact 5 labels, non-row li breaks no list machinery | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" -t "SCEN-04 header" --no-file-parallelism` | ✅ extend | ✅ done (5 tests, b7427750) |
| 03-T2 | 152-03 | 1 | SCEN-04 | T-152-03-01 | cause-accurate title + sr-only on the ADDED-row non-derivable branch ONLY; derived title byte-verbatim; per-key span untouched; SC3 falsifier observed | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" -t "honest notional" --no-file-parallelism` | ✅ extend | ✅ done (3 tests + SC3 observed, 25c31f7c) |
| 04-T1 | 152-04 | 2 | SCEN-02 | T-152-04-02 | handleAdd (site 4/4) passes isOwn true / undefined honestly — never fabricates | component | `npx vitest run "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx" -t "isOwn" --no-file-parallelism` | ✅ extend | ✅ green (3 passed, re-observed 152-06 T3) |
| 04-T2 | 152-04 | 2 | SCEN-05 | T-152-04-01 | dedup line only on FILTERED own-vs-own collisions; third-party rows never; missing created_at → no line; timezone-stable date; testid outside browse-add-; SC4 falsifier observed | component | `npx vitest run "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx" -t "dedup" --no-file-parallelism` | ✅ extend | ✅ green (9 passed; SC4 observed, see ledger) |
| 04-T3 | 152-04 | 2 | SCEN-02 | T-152-04-02 | YoursChip closed leaf (no OwnershipTag widening, no Badge); own rows only; locked honesty tokens | component | `npx vitest run "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx" --no-file-parallelism` | ✅ extend + new component | ✅ green (43 passed, re-observed 152-06 T3) |
| 05-T1 | 152-05 | 3 | SCEN-02 | T-152-05-01 | isOwn mapped at BOTH twin seams (two renders, two payloads); Bridge seam deliberately absent | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" -t "SCEN-02" --no-file-parallelism` | ✅ extend | ✅ green |
| 05-T2 | 152-05 | 3 | SCEN-02 | T-152-05-02 | chip gate `=== true`; false/null/absent each render NO node | component | same as 05-T1 | ✅ extend | ✅ green |
| 06-T1 | 152-06 | 4 | SCEN-03 | T-152-06-01/02 | one-open-at-a-time inline detail; in-memory only (no fetch); null metrics → honest note, never 0.00; href exactly /factsheet/{id} | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" -t "SCEN-03" --no-file-parallelism` | ✅ extend | ✅ done (8 tests RED→GREEN, 8d37a173) |
| 06-T2 | 152-06 | 4 | SCEN-03 | T-152-06-01 | Enter/Space on the focused strategy-name button; six control exclusions (incl. the include/exclude switch — B-2); panel-click no-collapse; axe scans EXPANDED panel; SC2 falsifier observed | component + e2e(CI) | same as 06-T1; `npx playwright test e2e/composer-axe.spec.ts` (CI seeded) | ✅ extend | ✅ done (10 more tests; SC2 + two exclusion falsifiers observed) |
| 06-T3 | 152-06 | 4 | all | — | phase gates: lint + typecheck + full `npm test` + blocking `npm run test:coverage`; ledger fully observed | gates | `npm run test:coverage` | ✅ | ✅ green (see Phase Gates below) |

---

## Phase Gates (152-06 T3, observed 2026-08-07)

| Gate | Command | Result |
|------|---------|--------|
| Lint | `npm run lint` | exit 0 — 0 errors, 1 pre-existing warning (`EquityChart.tsx:1119` exhaustive-deps, untouched by this phase); admin-route + route-contract manifests OK |
| Typecheck | `npm run typecheck` | exit 0 |
| Full suite | `npm test` | **11218 passed / 287 skipped / 0 failed** (784 files) |
| Coverage (blocking 82/80/74/72) | `npm run test:coverage` | exit 0 — **lines 88.04 / statements 85.98 / functions 82.75 / branches 80.43**, every threshold cleared with margin (the tightest is branches, +8.43 over the 72 floor) |
| New skips | `grep -c "it.skip\|describe.skip"` on the touched test files | 0 in `ScenarioComposer.test.tsx`, 0 in `composer-axe.spec.ts` — this phase introduced none |
| Threshold edits | `git diff vitest.config.ts` | empty — the gate was met, not moved |

⚠️ **Advisory framing (repo policy).** Branch protection is deferred until
paying clients, so every one of these gates is advisory at merge time. They are
evidence that a regression *would have been caught*, never a claim that anything
*was stopped*.

---

## Falsifiability Ledger

One row per ROADMAP Success Criterion. Each mutation is applied to PRODUCTION
source, the named test must go RED, then the mutation is reverted and green
re-observed. The owning task records the observation.

| SC | Requirement | Production-source mutation | Test that must go RED | Owner | Observed |
|----|-------------|----------------------------|------------------------|-------|----------|
| SC1 — ownership wired through the persisted schema | SCEN-02 | Delete `isOwn` from `addedStrategySchema` (leave the TS interface) | strip-guard `parsed.data.addedStrategies[0].isOwn` (scenario-state.test.ts, populated fixture) | 152-02 T2 | Observed ✅ RED then GREEN (2026-08-07) |
| SC2 — row opens richer detail | SCEN-03 | Neuter the name-button toggle (onClick sets `null` unconditionally) | SCEN-03 expand test + "Enter/Space on the focused strategy-name button" tests | 152-06 T2 | ✅ Observed 2026-08-07 — `setExpandedAddedId(null)` in place of the toggle → **18/18 SCEN-03 RED**, including "ONE click … LEAVES it open" and both "Enter/Space on the focused strategy-name button" tests; reverted from a scratchpad snapshot (md5 identical both directions) → 289/289 green |
| SC3 — numbers labelled, notional honest | SCEN-04 | Apply the remedy `title` to the DERIVED notional branch too (unconditional title) | derived-title-byte-verbatim test (SCEN-04 honest notional describe) | 152-03 T2 | ✅ Observed 2026-08-07 — `title={NOTIONAL_UNAVAILABLE_NOTE}` unconditional → "SCEN-04 honest notional (derived)" RED (`expected 'Notional needs live book equity…' to be 'Notional = equity × blend share…'`); reverted → 263/263 green |
| SC4 — no unresolvable browse duplicate | SCEN-05 | Drop the `isOwn === true` term from the collision-set builder | "a lone own row whose name matches TWO third-party rows gets no line" (StrategyBrowseDrawer SCEN-05 dedup describe) | 152-04 T2 | ✅ Observed 2026-08-07 — dropping `if (s.isOwn !== true) continue;` from pass 1 → RED (`browse-dedup-s-mix-own` rendered "Created Aug 4, 2026 · Private" where the test expects null); reverted from a scratchpad snapshot (sha verified identical) → 40/40 green |

**SC4 target correction (152-04 execution, 2026-08-07).** The plan named the
"two third-party rows get no line" test as the SC4 RED target. That test cannot
go RED under a builder-only mutation: the RENDER gate independently carries
`s.isOwn === true`, so third-party rows render nothing whether or not the
builder counts them — the mutation would have been observed GREEN and proven
nothing. A discriminating fixture was added instead — **one own row plus two
third-party rows all sharing a name** — where the own row passes every render-gate
term on its own merits and only the builder's own-only count keeps its line off.
Both tests are retained: the third-party pair (carrying a deliberately hostile
`created_at`/`status` the route would never emit) pins the render gate, and the
mixed fixture pins the builder.

Additional design-time falsifiers (not separately observed — enforced by test
construction, see RESEARCH `### Falsifiers`): `.nullish()`→`.boolean()` (null
tolerance), single-seam revert (two-render seam tests), `!== false` chip gate
(absent-state test), Set-based expansion state (one-open-at-a-time test),
sr-only drop (within-cell probe), testid rename into `browse-add-` (namespace
test), un-normalized collision key (case/whitespace test).

**Two extra SCEN-03 exclusion falsifiers observed (152-06 T2, 2026-08-07).** The
six control-exclusion assertions were written AFTER their implementation landed
in T1, so they were measured rather than assumed:

- **Dropping the include/exclude switch's own `e.stopPropagation()` (checker
  B-2)** → **exactly 1 RED**, the switch exclusion test, everything else green.
  This is the discriminating result: the switch sits in the row's LEFT cluster,
  outside the control-cluster wrapper, so no other exclusion could have covered
  it.
- **Dropping the control-cluster wrapper's `stopPropagation`** → **exactly 5
  RED** (weight, dollar, mode, leverage, remove) and the switch test still green
  — the complementary partition, confirming the two mechanisms are disjoint and
  that all six assertions are load-bearing rather than five of them riding on
  one guard.

Both mutations were reverted from the same scratchpad snapshot (md5 identical
both directions) and the full 289-test file re-observed green after each.

---

## Oracle Independence

The rules below — and every falsifier fixture — pin expectations as
independent literals or invariants: a test never recomputes its oracle with
the implementation's own formula (the money-math lesson: self-referential
oracles let three bugs survive six passes). Copy oracles (titles, notes, the
dedup line) are byte-literals in the tests.

**One deliberate exception:** 152-04 T2's dedup date. The preferred oracle is
the literal "Aug 4, 2026" / "Jul 20, 2026" (noon-UTC fixtures are
timezone-safe and Node ships full-icu); recomputing via the same
`toLocaleDateString` call is permitted only as a secondary wiring pin.

## Binding Oracle Rules

- **SCEN-02 wire:** the strip-guard test MUST use a POPULATED `addedStrategies` fixture
  (151-06's template fixture is `[]` — vacuity trap measured by research). Assert a v4
  blob WITHOUT `isOwn` decodes with outcome ≠ reset, AND a blob WITH `isOwn: true`
  round-trips through codec + save-route POST without stripping.
- **SCEN-02 fence (H-0300):** `route.test.ts:731-763` becomes TWO exhaustive arms —
  third-party row: exact key set UNCHANGED (no created_at/key_count/status/isOwn beyond
  spec); own row: exact key set including the new fields. Adding new keys to a single
  shared ALLOWED list is the forbidden fix.
- **SCEN-03:** clicking the strategy-name button expands exactly one detail panel
  (one-open-at-a-time owned by the list parent); factsheet link present iff the id
  resolves under OWN-02 visibility; null metrics render the honest "not available"
  copy — never `0.00`. Falsifier: neuter the expansion state → test RED.
- **SCEN-04:** header li renders ONLY above the added-strategies group; per-key rows
  gain no header (alignment scope call). Arrow-key/list-nav (if any) skips the
  non-interactive header li. Em-dash title+sr-only copy is CAUSE-ACCURATE (driven by
  `totalBookEquity == null`, NOT scenarioAum — research Open Q1; resolved D-3, pinned
  copy in 152-03-PLAN.md).
- **SCEN-05:** disambiguation secondary line renders ONLY when an OWN row's name
  collides with another OWN row in the same result; third-party rows never emit or
  render owner metadata. `created_at` alone resolves the founder's real case (15 days
  apart); omit-when-absent per UI-SPEC (D-1: no key_count segment at all).

---

## Wave 0 Requirements

- [x] Grep `addedStrategies` across `src/app/api/**` + `analytics-service/**` for any
      `.strict()` schema that would REJECT (not strip) the new field.
      **CLOSED at planning (2026-08-07):** zero `.strict()`/`strictObject` hits under
      `src/app/api/allocator/` and `allocations/lib/`; zero `addedStrategies`
      references in `analytics-service/**`; the only non-schema server reader is
      `share/route.ts` (structural `Array.isArray` check, key-indifferent). Matches
      PATTERNS Mapper Note 3. The wire add cannot turn into a 400.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two Alpha Centauri rows distinguishable at a glance | SCEN-05 | PROD data state | Founder account → Browse: both rows show created dates; choice resolvable |
| Founder can answer "what do the numbers mean" | SCEN-04 | Founder-eyes | Composer added rows show WEIGHT/USD/MODE/LEV/NOTIONAL header |
| Header alignment over live columns (incl. Target-mode drift acceptance) | SCEN-04 | Pixel alignment not jsdom-measurable | Composer with ≥1 added row: labels sit over their columns in default Leverage mode; a Target-mode row drifts on that row only (accepted, Pitfall 3) |
