---
phase: 152-scen-composer-legibility
plan: 04
subsystem: ui
tags: [react, vitest, browse-drawer, ownership, pseudonymity, design-system]

# Dependency graph
requires:
  - phase: 152-01
    provides: "GET /api/strategies/browse emitting isOwn on every row + created_at/status on own rows only"
  - phase: 152-02
    provides: "AddedStrategy.isOwn declared on the interface and the nested zod schema — the persisted twin of the payload field written here"
  - phase: 150 (OWN-03)
    provides: "OwnershipTag ANATOMY + team_review ink strings, copied byte-verbatim; the T-150-08 closed-switch rationale this plan must not widen"
provides:
  - "YoursChip — the shared ownership chip leaf (closed, no variant prop), importable by 152-05 for composer-row parity"
  - "StrategyBrowseRow declares isOwn/created_at/status; drawer AddedStrategy declares isOwn"
  - "handleAdd (construction site 4-of-4) passes isOwn through honestly — true or undefined, never fabricated"
  - "own-vs-own duplicate disambiguation line over the FILTERED result (browse-dedup-{id})"
  - "Yours chip on own browse rows (browse-yours-{id})"
affects: [152-05, 152-06, StrategyBrowseDrawer, ScenarioComposer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-pass O(n) collision set derived in a useMemo keyed on the FILTERED rows, so a narrowing filter clears a tiebreaker line"
    - "Closed presentational leaf (no variant prop) as an anti-spoofing measure — a component with no input cannot be made to claim something else"

key-files:
  created:
    - src/app/(dashboard)/allocations/components/YoursChip.tsx
  modified:
    - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx
    - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx
    - .planning/phases/152-scen-composer-legibility/152-VALIDATION.md

key-decisions:
  - "The SC4 falsifier target named in the plan could not go RED and was replaced. A builder-only mutation leaves the two-third-party-rows test GREEN, because the RENDER gate independently carries `s.isOwn === true`. A mixed fixture (one own row + two third-party rows sharing a name) was added as the real target: the own row passes every render-gate term on its own merits, so only the builder's own-only count keeps its line off."
  - "The third-party fixture deliberately carries created_at/status the 152-01 route would never emit. The drawer does not get to assume the route upstream stayed correct — two independent fences, each separately tested."
  - "The dedup line's date oracles are literals (\"Aug 4, 2026\"), never a recomputation of the implementation's own toLocaleDateString call. Verified stable at the local TZ (Africa/Johannesburg, UTC+2) and CI (UTC); vitest pins no TZ."
  - "productCaseStatus is a local module helper, not a lookup table: the raw enum set is owned by the DB and a table would silently render nothing for a value it had not been taught, where a mechanical transform degrades gracefully."

patterns-established:
  - "Collision/tiebreaker UI computes its set over the FILTERED rows, not the full fetch — otherwise narrowing strands the line on a row that is no longer ambiguous, turning a tiebreaker into a metadata dump"
  - "A one-sided 'carries true' payload test passes against an implementation that hardcodes true; pair it with an absence test asserting toBeUndefined()"

requirements-completed: [SCEN-02, SCEN-05]

# Metrics
duration: ~14min
completed: 2026-08-07
tasks: 3
files-changed: 4
---

# Phase 152 Plan 04: Browse drawer — isOwn seam, dedup line, Yours chip Summary

**The browse drawer now carries the ownership bit across its own `onAdd` seam
(the one construction site no other suite can reach), renders the founder's two
identically-named "Alpha Centauri" rows as resolvable via a created-date
tiebreaker, and marks own rows with a shared `YoursChip` leaf that Plan 152-05
imports rather than re-rolls.**

## Performance

- **Duration:** ~14 min
- **Tasks:** 3 (all TDD — RED observed before each implementation)
- **Files changed:** 4 (1 created, 3 modified)

## Accomplishments

- **Construction site 4-of-4 closed.** `handleAdd` appends `isOwn: s.isOwn` as a
  straight pass-through. This is the only `AddedStrategy` construction site
  unreachable from `ScenarioComposer.test.tsx` (that suite module-mocks the
  drawer away), so a drop here would have reddened nothing over there. Two
  tests pin it from both sides: an own row yields `true`, a legacy row yields
  `toBeUndefined()` — the second is what fails an implementation that hardcodes
  `isOwn: true`.
- **Dedup line behind three independent gates**, each separately falsifiable:
  `isOwn === true`, a detected collision over the FILTERED rows, and
  `created_at` present. Copy is `Created Aug 4, 2026 · Private` — no key-count
  segment (D-1), status product-cased so the raw DB enum never reaches the DOM.
- **`YoursChip` shipped as a closed leaf** — no variant prop, one label, one
  ink. It neither widens the capital-ownership tag's sealed switch (T-150-08)
  nor routes through the status badge whose unrecognised-label branch falls back
  to a credible-looking DRAFT badge.
- **SC4 falsifier observed** — and the plan's named target was found
  non-discriminating and corrected (see Deviations).

## Task Commits

1. **Task 1: Widen drawer declarations + carry isOwn through handleAdd** — `0c5e2773` (feat)
2. **Task 2: Own-vs-own dedup line over the filtered result + SC4 falsifier** — `b9861d24` (feat)
3. **Task 3: YoursChip leaf + D-4 chip parity on own browse rows** — `855396a2` (feat)

No separate `test(...)` RED commits: each task's RED was observed in the working
tree and committed together with its GREEN implementation, matching this phase's
per-task atomic-commit contract.

## Files Created/Modified

- **`YoursChip.tsx` (new)** — module consts `ANATOMY` (byte-verbatim from
  `OwnershipTag.tsx:35`) and `INK` (byte-verbatim `team_review` ink, `:48`);
  renders `<span className={cn(ANATOMY, INK, className)}>Yours</span>`. Header
  documents why it is a separate component rather than a widened switch or a
  Badge call, why `rounded-md` (persistent-fact family) and sentence case, and
  why there is no variant prop. Sole import is `cn` — no OwnershipTag, no Badge.
- **`StrategyBrowseDrawer.tsx`** — `StrategyBrowseRow` gains `isOwn?`,
  `created_at?`, `status?` (each TSDoc'd in the `is_example` voice: phase,
  truthy meaning, absence meaning, why not a disclosure widening); drawer
  `AddedStrategy` gains `isOwn?`; module-level `normalizeStrategyName` +
  `productCaseStatus`; an `ownNameCollisions` memo keyed on `filtered`; the
  dedup `<div>` and the `<YoursChip>` in the row's name cluster.
- **`StrategyBrowseDrawer.test.tsx`** — three new describes, 14 tests
  (2 payload + 9 dedup + 3 chip). Suite: 31 → 43.
- **`152-VALIDATION.md`** — SC4 ledger row marked observed, plus a note
  recording the target correction.

## Decisions Made

- **The SC4 falsifier target was wrong as planned, and saying so mattered more
  than recording a green tick.** The plan asked for the `isOwn === true` term to
  be dropped from the collision BUILDER and for the two-third-party-rows test to
  go RED. It would not have: the render gate carries its own `isOwn === true`
  term, so third-party rows render nothing either way. Running the mutation as
  written would have produced a GREEN result recorded as a passed falsifier —
  the exact self-deception the ledger exists to prevent. A mixed fixture (one
  own row + two third-party rows sharing a name) makes the builder the only
  thing standing between the own row and a false duplicate claim; the mutation
  reddens it. Both tests are retained — they pin different gates.
- **The hostile third-party fixture carries `created_at`/`status`.** The route
  never emits them, so a faithful fixture would make the drawer's `isOwn` gate
  untested — it would pass on the `typeof created_at` term alone. Testing the
  fence means feeding it what it is supposed to refuse.
- **`status` casing is a mechanical transform, not a lookup table.** A table
  keyed on the five known enum values renders *nothing* for a sixth the DB later
  grows; `replace(/_/g, " ")` + capitalize degrades to a readable string.
- **Collision scope is `filtered`, and the narrowing test is the proof.** A set
  computed over `strategies` passes every other dedup test in this suite and
  fails only when a filter leaves one row of a pair visible.

## Deviations from Plan

### Auto-fixed / corrected

**1. [Rule 1 — Non-discriminating falsifier] SC4 target test replaced**
- **Found during:** Task 2, preparing the falsifier run
- **Issue:** The plan's named RED target ("two third-party rows get no line")
  is insensitive to the plan's own named mutation (dropping `isOwn === true`
  from the collision builder), because the render gate carries an independent
  `isOwn === true` term. Observing it would have yielded GREEN and been recorded
  as a satisfied falsifier.
- **Fix:** Added a mixed-fixture test — one own row plus two third-party rows
  all named "Shared Label" — which the mutation reddens (`browse-dedup-s-mix-own`
  rendered "Created Aug 4, 2026 · Private" where null is expected). Retained the
  original test as the render-gate pin.
- **Files modified:** `StrategyBrowseDrawer.test.tsx`, `152-VALIDATION.md`
- **Commit:** `b9861d24`

**2. [Scope refinement] Two tests added beyond the plan's seven dedup behaviors**
- The status test (product-cased `pending_review` → "Pending review", raw enum
  absent from the DOM, and the omitted-segment branch when `status` is absent)
  pins the UI-SPEC copy contract, which no listed behavior covered. The testid
  namespace behavior was kept as its own test rather than folded into another.
- Final dedup count: 9 tests, not 7.

### Interpretation, not change

- The plan's acceptance criterion `grep -c "browse-dedup-"` **≥ 1** returns
  exactly **1** — the testid template literal. The render-site comment refers to
  the `browse-add-` namespace, not the dedup one, so it does not inflate the count.
- `grep -c "OwnershipTag"` on `YoursChip.tsx` returns **1**, a prose reference
  to the source path in the header comment. No import — the file's only import
  is `cn` from `@/lib/utils`.

## Authentication Gates

None.

## Threat Flags

None. No new network endpoint, auth path, file access, or schema change — this
plan is render-side only, consuming a wire that landed in 152-01.

Threat register dispositions, all `mitigate`, all held:
- **T-152-04-01** (own metadata disclosure): the `isOwn === true` term appears in
  BOTH the collision builder and the render gate, and the route independently
  withholds `created_at`/`status` from third-party rows. The hostile-wire test
  proves the drawer refuses leaked metadata on its own.
- **T-152-04-02** (chip spoofing): `YoursChip` is closed by construction — no
  variant prop, no fallback branch, no Badge routing, no widening of the sealed
  `CapitalOwnership` switch. The gate is `=== true`, pinned by the absent-isOwn test.
- **T-152-04-03** (automation contract): `browse-dedup-{id}` and
  `browse-yours-{id}` sit outside the `browse-add-` first-match namespace;
  asserted in two dedicated tests, plus a positive check that the strategy-add
  selector still resolves only to Add buttons.

## Known Stubs

None.

## Verification

| Check | Result |
|-------|--------|
| `vitest run StrategyBrowseDrawer.test.tsx --no-file-parallelism` | **43 passed (43)** — was 31 |
| `vitest run ScenarioComposer.test.tsx --no-file-parallelism` | 263 passed (263) — direct consumer, unbroken |
| `tsc --noEmit` (whole project) | clean |
| `eslint` on drawer + YoursChip + test | clean (`no-raw-font-px` untriggered — `text-caption` only) |
| `grep -c "isOwn: s.isOwn"` (drawer) | 1 |
| `grep -c "browse-dedup-"` (drawer) | 1 (the testid) |
| collision memo dependency array | `}, [filtered]);` — not `strategies` |
| byte-verbatim ANATOMY + INK strings in YoursChip | 1 each |
| deletions across the three commits | none |

**SC4 falsifier:** removed `if (s.isOwn !== true) continue;` from the collision
builder's pass 1 → **1 failed | 8 passed**, RED on "a lone own row whose name
matches TWO third-party rows gets no line". Reverted from a scratchpad snapshot
(`shasum` verified byte-identical) → **43/43 green**.

## User Setup Required

None.

## Next Phase Readiness

- **152-05 imports `YoursChip` from
  `./YoursChip`** for the composer-row chip — same component, not a second
  recipe (D-4). Props are `{ className?, "data-testid"? }`; the caller owns the
  `isOwn === true` gate.
- The full `isOwn` chain is now continuous from DB to draft: route (152-01) →
  drawer row → `handleAdd` payload → `AddedStrategy` → nested zod schema
  (152-02). 152-05's remaining work is the composer's own twin seams and the
  chip render — no wire work left.
- ⚠️ `browse-yours-{id}` and `browse-dedup-{id}` are automation-contract
  testids; keep any future additions out of the `browse-add-` prefix.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/components/YoursChip.tsx` — FOUND
- `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` — FOUND
- `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx` — FOUND
- `.planning/phases/152-scen-composer-legibility/152-VALIDATION.md` — FOUND
- Commit `0c5e2773` — FOUND
- Commit `b9861d24` — FOUND
- Commit `855396a2` — FOUND

---
*Phase: 152-scen-composer-legibility*
*Completed: 2026-08-07*
