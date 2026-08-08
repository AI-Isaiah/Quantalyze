---
phase: 152-scen-composer-legibility
plan: 06
subsystem: allocations-scenario-composer
tags: [SCEN-03, a11y, row-detail, honesty-copy, phase-gates, ui]

# Dependency graph
requires:
  - phase: 152-03
    provides: "the added-row shape this panel mounts into (the non-row header `<li>` and the hoisted `nText`), untouched here"
  - phase: 152-05
    provides: "the name cluster's locked four-child order — the name span this plan converts to a button is its first child"
provides:
  - "addedMetricsByRef — narrow {cagr, sharpe} presentation-only prop on CompositionList"
  - "the strategy-name `<button>` with aria-expanded / aria-controls (the phase's only new keyboard affordance)"
  - "scenario-detail-{id} — the one-open-at-a-time inline detail panel + its five field seams"
  - "the three-part control-exclusion set (name button, include/exclude switch, control-cluster wrapper) + the panel's own stop"
  - "e2e/composer-axe.spec.ts scans the EXPANDED panel"
  - "152-VALIDATION.md complete — 13/13 task rows green, 4/4 Falsifiability Ledger rows Observed"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pointer amplification on a container needs its exclusions PARTITIONED and each partition measured: dropping the cluster wrapper reddened exactly 5 tests, dropping the switch's own stop reddened exactly 1 — complementary sets, which is what proves no assertion is riding on another guard"
    - "A control that shares a functional toggle with its own container must stopPropagation BEFORE toggling, or one click nets to a no-op — and the failure is invisible to a keyboard test too, because a native button dispatches click for Enter/Space"
    - "Count OPEN panels on an attribute only the panel carries (`[id^=…]`), not the shared testid prefix its own field seams inherit — otherwise the one-open-at-a-time oracle counts fields"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - e2e/composer-axe.spec.ts
    - .planning/phases/152-scen-composer-legibility/152-VALIDATION.md
    - TODOS.md

key-decisions:
  - "The metrics-absent NOTE and the per-field em-dash are mutually exclusive, not additive: when both figures are null the CAGR/SHARPE blocks do not render at all and one sentence stands in their place; when one is null the pair renders and the missing side is a dash. Two dashes plus a note would be the same absence stated twice, and the note's remedy ('open the factsheet') is only true when there is nothing at all to show."
  - "The metrics-null arm is fixtured as a BOOK strategy whose analytics are null rather than as a genuinely drawer-added id. An id absent from `payload.strategies` fires the lazy `/api/strategies/{id}/returns` fetch, which is orthogonal to a panel that by construction never fetches; the lookup's null pair is byte-identical either way, so the fixture pins the branch under test without importing a network stub into it."
  - "Panels are counted via `[id^=\"scenario-detail-\"]`, not the testid prefix. The field seams (`scenario-detail-cagr-…` etc.) share that testid prefix by design, so a prefix count would have counted six nodes per open panel and the one-open-at-a-time oracle would have been meaningless. Only the panel carries an `id` (it has to — aria-controls points at it)."
  - "The six exclusion assertions each fire in BOTH directions (collapsed must not open, open must not close). One direction alone is vacuous in a knowable way: 'still closed' passes against a panel that never opens, 'still open' against one that never closes."

requirements-completed: [SCEN-03]

# Metrics
duration: ~35min
completed: 2026-08-07
tasks: 3
files-changed: 5
---

# Phase 152 Plan 06: SCEN-03 row detail + phase close Summary

**The composer's strategy rows stop being dead ends: the name is now a real
button that expands one honest inline panel — provenance, markets, types, CAGR,
Sharpe, and a "View factsheet →" link — built entirely from data already in
memory, and the phase closes with all four Success Criteria falsified-and-green
under blocking coverage.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (Tasks 1 and 2 TDD — RED observed before each implementation)
- **Files changed:** 5

## Accomplishments

- **The panel never invents a number.** `formatPercent`/`formatNumber` carry the
  null semantics, so there is no inline `toFixed` anywhere in the diff and no
  path to a `0.00`. A row with one known metric shows it beside a dash; a row
  with neither shows one sentence naming the remedy. The honesty test does not
  merely check for the sentence — it sweeps the whole panel's text for a
  zero-shaped figure, which is the assertion a `?? 0` "fix" would redden.
- **B-1 was real, and the test that would have caught it is the headline one.**
  The name button lives in the row's LEFT cluster, outside the control-cluster
  wrapper, so its click bubbles into the row's pointer-amplification handler —
  which runs the *same* functional toggle. Without `e.stopPropagation()` before
  the toggle, one click nets to a no-op and the panel can never open by pointer
  *or* keyboard (a native button dispatches click for Enter/Space). The expand
  test asserts the panel is open after **one** click, never two.
- **The exclusion set was measured, not asserted.** Because the six exclusion
  tests were written after their implementation landed in Task 1, both guards
  were mutated: dropping the cluster wrapper reddened exactly five tests
  (weight, dollar, mode, leverage, remove) and dropping the switch's own stop
  reddened exactly one. Complementary partitions — so no assertion is passing on
  another guard's back.
- **The axe scan now covers DOM that only exists while expanded.** The composed
  scan gained an expand click targeted by `aria-controls` (the exploratory
  fixture renders a masked codename, so the attribute is the only stable handle)
  plus an `aria-expanded="true"` assertion before `analyze()` — without that
  assertion a silently no-opped click would leave axe scanning a collapsed row
  and reporting a hollow pass.
- **The phase closes clean.** Lint, typecheck, the full 11,218-test suite and
  the blocking coverage gate are all green; the Falsifiability Ledger reads 4/4
  Observed and every per-task row in the verification map is now ticked.

## Task Commits

1. **Task 1: addedMetricsByRef thread + name button + inline detail panel** — `8d37a173` (feat)
2. **Task 2: keyboard + six control exclusions, axe expanded-panel coverage, SC2 falsifier** — `6787adec` (test)
3. **Task 3: phase-final gates, ledger complete, residuals logged** — `073a830a` (docs)

## Files Modified

- **`ScenarioComposer.tsx`** — `formatNumber` import; the `addedMetricsByRef`
  useMemo beside `addedProvenanceByRef`; the prop on `CompositionListProps`,
  destructured and threaded at the call site; `expandedAddedId` +
  `toggleAddedDetail` + the `DETAIL_EYEBROW` recipe constant inside
  `CompositionList`; the row `<li>`'s amplification `onClick`; the name span →
  `<button>`; `stopPropagation` on the include/exclude switch and on the
  control-cluster wrapper; and the detail panel itself with its own stop.
- **`ScenarioComposer.test.tsx`** — new
  `describe("ScenarioComposer — SCEN-03 detail (Phase 152)")`, 18 tests, plus
  the `@testing-library/user-event` import. Suite: 271 → 289.
- **`e2e/composer-axe.spec.ts`** — the expand step + `aria-expanded` gate before
  the composed `analyze()`. The self-skip guard and every pre-existing
  visible-anchor gate are untouched (`git diff` over them is empty).
- **`152-VALIDATION.md`** — SC2 observation, two extra exclusion-falsifier
  observations, all 13 per-task rows ticked, a Phase Gates table, and the
  frontmatter flip `status: planned → complete`.
- **`TODOS.md`** — the two deferred residuals (below).

## Verification

| Check | Result |
|-------|--------|
| `vitest run ScenarioComposer.test.tsx --no-file-parallelism` | **289 passed (289)** — was 271 |
| `vitest run ScenarioComposer.test.tsx -t "SCEN-03"` | 18 passed |
| `npm run lint` | exit 0 — 0 errors, 1 pre-existing warning (`EquityChart.tsx:1119`, untouched) |
| `npm run typecheck` | exit 0 |
| `npm test` (full) | **11218 passed / 287 skipped / 0 failed** (784 files) |
| `npm run test:coverage` (blocking 82/80/74/72) | exit 0 — **lines 88.04 / statements 85.98 / functions 82.75 / branches 80.43** |
| `git diff vitest.config.ts` | empty — the gate was met, not moved |
| `grep -c "addedMetricsByRef"` (component) | **5** (derive + props decl + destructure + thread + read) ≥ 3 |
| `toFixed` in the component diff | 2 hits, **both inside comments** — no formatting code added |
| `fetch(` / `useEffect(` in the component diff | 0 — the CONTEXT no-new-fetch lock holds |
| expansion state | `useState<string \| null>(null)` — no Set |
| `it.skip` / `describe.skip` in the touched test files | 0 in both — this phase introduced no skips |
| `playwright test e2e/composer-axe.spec.ts --list` | 1 test resolved (spec still parses; it self-skips without seed env) |
| deletions across all three commits | none |

### Falsifiers observed (2026-08-07)

All three mutations were applied to the production source and reverted from the
same scratchpad snapshot (md5 identical in both directions, verified each time);
the full 289-test file was re-observed green after each.

**SC2 — neutered toggle (the ledger's own mutation).** Replacing the name
button's `toggleAddedDetail(a.id)` with `setExpandedAddedId(null)` →
**18/18 SCEN-03 RED**, including "ONE click … LEAVES it open" and both
"Enter/Space on the focused strategy-name button" tests. Recorded in
152-VALIDATION.md.

**Exclusion falsifier A — the include/exclude switch (B-2).** Dropping that
button's own `e.stopPropagation()` → **exactly 1 RED**, the switch exclusion
test, with all seventeen others green. This is the discriminating result: the
switch sits in the LEFT cluster, so no other guard could have covered it.

**Exclusion falsifier B — the control-cluster wrapper.** Dropping the wrapper's
`stopPropagation` → **exactly 5 RED** (weight, dollar, mode, leverage, remove)
and the switch test still green — the complementary partition. Together the two
runs account for all six exclusion assertions with no overlap.

## Deviations from Plan

### Auto-fixed / strengthened

**1. [Rule 2 — missing branch] A single-null metrics test was added beyond the plan's seven behaviours**
- **Found during:** Task 1, implementing the `metricsAbsent` gate
- **Issue:** The plan's `<behavior>` list covers both-null and both-present, and
  the `<interfaces>` copy note mentions in passing that "a single null renders
  '—' via the formatter" — but no test pinned it. The gate
  `cagr == null && sharpe == null` has three arms, and the untested middle one is
  precisely where a lazy `||` would hide: it would suppress the whole pair for a
  half-known row and swallow a real Sharpe.
- **Fix:** an eighth test (`ONE metric null`) asserting the pair still renders,
  CAGR is `—` and Sharpe is `1.25`, and the absence note is NOT shown.
- **Files modified:** `ScenarioComposer.test.tsx`
- **Commit:** `8d37a173`

**2. [Rule 2 — non-vacuity] The exclusion assertions were extended to both directions and then measured**
- **Found during:** Task 2
- **Issue:** The plan asks that clicking each control "does not change the
  panel's presence". Written one-directionally that is a knowably weak oracle —
  asserting "still closed" passes against a component whose panel never opens.
  Worse, these tests were authored AFTER their implementation, so they had no
  RED phase to vouch for them.
- **Fix:** a shared `expectExcluded` helper drives each control with the panel
  collapsed AND expanded, and the two guards were then mutated separately
  (falsifiers A and B above) to prove the six assertions partition cleanly.
- **Files modified:** `ScenarioComposer.test.tsx`
- **Commit:** `6787adec`

### Interpretation, not change

- **The metrics-null fixture is a book strategy with null analytics, not a
  genuinely drawer-added id.** The plan's behaviour says "drawer-added strategy
  (both metrics null)". A drawer-added id — one absent from `payload.strategies`
  — fires the composer's lazy returns fetch, which would drag a network stub into
  a block testing a panel that by construction never fetches. The lookup's null
  pair is byte-identical from either source, so the fixture pins the branch under
  test and nothing else. Recorded in-test.
- **`152-VALIDATION.md` rows for plans 01/02/04 were ticked here, not assumed.**
  Their own commands were re-run at Task 3 (`route.test.ts -t "H-0300"` 3 passed;
  `route.test.ts` 31; `scenario-state.test.ts -t "isOwn"` 4;
  `StrategyBrowseDrawer.test.tsx` 43, `-t "dedup"` 9, `-t "isOwn"` 3) rather
  than inferred from the full-suite green.
- **Gates are advisory at merge.** Branch protection is deferred until paying
  clients, so every gate above is evidence a regression *would have been caught*,
  never a claim that one *was stopped*.

### Architectural changes

None.

## Authentication Gates

None.

## Threat Flags

None. Render-side and client-state only — no network endpoint, no auth path, no
file access, no schema change. The one new outbound surface is an `<a href>`.

Threat register dispositions, all held:
- **T-152-06-01** (factsheet link, `transfer`): the panel emits
  `/factsheet/{id}` for an id the viewer's own draft already contains. No id is
  disclosed that the viewer did not already hold, and access control stays
  server-side in OWN-02's two-lane selection + `strategies_read` RLS.
- **T-152-06-02** (panel content, `mitigate`): in-memory projection only — the
  zero-fetch lock is verified by grep (`fetch(`/`useEffect(` absent from the
  component diff), so the panel adds no wire surface at all.
- **T-152-06-03** (panel render, `accept`): no loading and no failure state
  exists by construction; null renders honest absence.
- **T-152-06-SC** (package installs, `accept`): zero installs this phase.

## Known Stubs

None. Every field the panel renders is wired to real in-memory data, and the
absence states are deliberate honest-absence renders (documented above), not
placeholders awaiting a later plan.

## Deferred Issues

Both logged to `TODOS.md` as non-blocking deferred items, per the plan:

- **Pitfall 6 — a stale persisted draft's factsheet link can 404.** The link
  resolves for the viewer's own strategies and for currently-published
  third-party ones; a draft persisted weeks ago can still name a since-archived
  third-party strategy. Detecting that needs a per-row existence fetch, which
  this phase's CONTEXT locks out. The right fix belongs to a draft-reconciliation
  pass at load, not a per-row fetch at render.
- **D-1 residual — same-day own-row duplicates stay indistinguishable in
  Browse.** The disambiguation line is `Created {Mon D, YYYY} · {Status}`; two
  own rows created the same day render identical lines. Revisit only if the
  founder treats key count as load-bearing.

## User Setup Required

None.

## Next Phase Readiness

- **Phase 152 is functionally complete.** SCEN-02..05 are all shipped and
  `152-VALIDATION.md` is `status: complete` with 4/4 Success Criteria observed.
- ⚠️ **`scenario-detail-{id}` is the panel; `scenario-detail-{field}-{id}` are
  its seams.** They deliberately share a prefix, so any future count assertion
  over open panels must key on the `id` attribute (only the panel has one),
  never on the testid prefix.
- ⚠️ **The added row now has THREE stopPropagation sites plus the panel's own.**
  Anyone adding a new interactive control to the row must place it inside the
  control-cluster wrapper or give it its own stop — a control in the LEFT
  cluster without one will toggle the detail on every click. The comments at
  each site name the failure mode.
- ⚠️ **`e2e/composer-axe.spec.ts` now depends on the name button's
  `aria-controls`.** Renaming the panel id breaks the e2e locator, and CI is the
  only place that would tell you (the spec self-skips locally).
- The row `<li>` is now click-handling. A future plan that wants a second
  row-level gesture must reconcile with the amplification handler rather than
  add a competing one.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — FOUND
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — FOUND
- `e2e/composer-axe.spec.ts` — FOUND
- `.planning/phases/152-scen-composer-legibility/152-VALIDATION.md` — FOUND
- `TODOS.md` — FOUND
- `.planning/phases/152-scen-composer-legibility/152-06-SUMMARY.md` — FOUND
- Commit `8d37a173` — FOUND
- Commit `6787adec` — FOUND
- Commit `073a830a` — FOUND

---
*Phase: 152-scen-composer-legibility*
*Completed: 2026-08-07*
