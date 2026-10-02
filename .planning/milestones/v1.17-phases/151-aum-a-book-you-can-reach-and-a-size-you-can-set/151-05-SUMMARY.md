---
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
plan: 05
subsystem: ui
tags: [typescript, react, vitest, scenario-composer, gate-repoint]

# Dependency graph
requires:
  - phase: 151-02
    provides: "allocatorEligibleApiKeyIds / contributingApiKeyIds / bookEntryGateSatisfied on both getMyAllocationDashboard return branches"
  - phase: 63-engine-03
    provides: "canEnterBook / usePerKeySources / the forced-blank init this plan relaxes"
  - phase: 112-weights-02
    provides: "pruneLeverageToDraftRefs + its eligiblePerKeyIds keep-set"
provides:
  - "ScenarioComposer book entry on the SPLIT gate — a partial book (>= 1 contributing allocator key) reaches book mode with a per-key engine"
  - "dataSourceKeys + perKeyAdapterOutput narrowed to contributingApiKeyIds — toggle-row basis, engine basis and bookEquity basis are one set"
  - "scenario-partial-book-note — the muted '{N} of {M} keys not yet contributing' disclosure"
  - "eligiblePerKeyIds on the allocator-ELIGIBLE basis, decoupled from usePerKeySources — stored leverage survives Save"
affects: [151-06 AUM input, 151-07 per-strategy dollar input]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Repoint the CONSUMERS, freeze the FLAG: the old all-or-nothing gate keeps all four of its MEMBER-04 consumers byte-unchanged while exactly three book-entry consumers move to the new one"
    - "Legacy-equivalent fixture derivation: a test payload builder DERIVES new split fields from the legacy ones, so ~200 pre-split fixtures keep their behaviour without per-test edits"
    - "A row-basis narrowing must carry its ENGINE basis with it, or the narrowing itself creates an undisclosed untoggleable source"
    - "A prune keep-set is a destruction guard, not a display filter — never couple it to a display predicate"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx

key-decisions:
  - "perKeyAdapterOutput was narrowed to contributingApiKeyIds too, though the plan's five-consumer blast-radius list did not name it (it reads eligibleApiKeyIds directly, not dataSourceKeys). Its own comment states the invariant 'blend ONLY eligible keys, the SAME set that gets a toggle row' — narrowing the rows alone would have broken it, letting manager keys (which DO carry a per-key series) ride the engine with no toggle row. That is the exact DSRC-03 defect the filter exists to prevent."
  - "eligiblePerKeyIds was decoupled from usePerKeySources as well as from dataSourceKeys. The plan asked only to keep it on the allocator-eligible basis, but Test 10 could not pass with the usePerKeySources gate: reopening a saved book draft syncs the session to BLANK (targetEntryMode is frozen on the old flag), which emptied the keep-set and pruned the override. A prune keep-set is a destruction guard; gating it on a display predicate is what made the leverage droppable."
  - "targetEntryMode (the reopen mode-sync) was NOT repointed despite being the root cause of Test 10's first failure. The plan freezes it by research directive and an explicit acceptance criterion. Logged as DEF-151-05-B with the analysis, rather than unilaterally unfreezing a plan-frozen consumer from a parallel worktree."
  - "ScenarioComposer.save.test.tsx needed the same fixture derivation. It builds its payload with an `as MyAllocationDashboardPayload` cast, so 151-02's three additive fields were never forced onto it by the typechecker and arrived `undefined` — which the repointed `?? false` reads as 'no reachable book'."
  - "The partial-book note renders OUTSIDE the CollapsibleSection, immediately above it. Inside would satisfy 'directly above the list' literally but a collapsed section would hide it, breaking the UI-SPEC never-silent invariant."

patterns-established:
  - "When a plan enumerates a blast radius by one symbol (dataSourceKeys), also grep for consumers of the UNDERLYING payload field (eligibleApiKeyIds) — they carry the same invariant without appearing in the list"
  - "A cast-built test fixture is invisible to an additive-field typecheck sweep; grep for `as PayloadType` after adding required fields"

# Metrics
duration: ~55min
completed: 2026-08-07
---

# Phase 151 Plan 05: Composer split-gate repoint (AUM-04) Summary

Repointed the composer's book-entry gate onto 151-02's `bookEntryGateSatisfied`
so a partial book reaches "From my book" with a per-key engine behind it,
narrowed the per-key row AND engine bases to `contributingApiKeyIds`, and added
the muted partial-book note — while the MEMBER-04 stamp, its derive, the reopen
fingerprint and `liveBaselineMetrics` stay byte-frozen on the old all-or-nothing
flag.

## What Was Built

**Task 1 — the gate repoint.** Exactly three consumers moved to
`payload.bookEntryGateSatisfied ?? false`: `canEnterBook`, the mode-switch
handler's defence-in-depth guard (plus its dep array), and `usePerKeySources`.
The founder's ~$460k book — 8 keys of which 6 are strategy-linked manager keys —
pinned the all-or-nothing gate FALSE, so blank slate was FORCED, not chosen. It
now initializes to book mode. Comments record the Pitfall-5 asymmetry (AUM is
custody, the gate is modelling capability — no copy may claim the AUM is "from
these N keys") and the Open-Q4 narrowing (a ZERO-contributing book still
initializes blank; an engineless "From my book" is a worse dead end, and
151-06's manual AUM input removes blank mode's residual harm).

**Task 2 — the narrowed basis and the note.** `dataSourceKeys` filters on
`contributingApiKeyIds`, so a key with no series renders no dead 0.000 row and
`totalBookEquity` — which sums over exactly that set — narrows with it.
`perKeyAdapterOutput` was narrowed to the same set (see Deviations).
`showDataSourcesFallback` gained `&& !bookEntryGateSatisfied`, so its
"blends your whole book" sentence only appears when that sentence is true. The
note renders `{N} of {M} keys not yet contributing — no per-key history yet.`
in `mt-2 text-xs text-text-muted`, no `role`, no `aria-live`, counts on the
allocator-eligible basis so manager keys sit in neither number.

## Task Commits

| Task | Gate | Commit | Description |
| ---- | ---- | ------ | ----------- |
| 1 | RED | `8c8b6a66` | AUM-04 suite + `partialBook` fixture (3 failed: no book segment, no per-key engine, blank-mode stamp) |
| 1 | GREEN | `2021ef4d` | Three consumers repointed; both fixture builders derive the split fields legacy-equivalently |
| 2 | RED+GREEN | `1fdfda14` | Tests 5/5b/6/7/8/9/10 observed RED (7 failed), then the narrowing + note + keep-set fix |
| — | docs | `e65fa11a` | DEF-151-05-A / DEF-151-05-B |

Task 2's RED and GREEN share a commit: the seven behaviours were written and
observed failing together before any source edit, but the plan's `files_modified`
are two files edited in one pass, so splitting would have produced a commit whose
source half is empty.

## Verification

- `npx vitest run "…/ScenarioComposer.test.tsx" --no-file-parallelism` →
  **232 passed** (221 pre-existing + 11 new).
- `npx vitest run "src/app/(dashboard)/allocations"` → **122 files / 1694 tests
  passed**.
- `npm run typecheck` → exit 0. `npm run lint` → **0 errors** (1 pre-existing
  `EquityChart.tsx` exhaustive-deps warning, same as 151-02's baseline).

**Grep gates:**
- `payload.bookEntryGateSatisfied` in the composer → **4** (canEnterBook, the
  mode-switch guard, its dep array, usePerKeySources) — criterion was `>= 3`.
- `scenario-partial-book-note` → exactly **1** render site; the block contains
  `text-text-muted` and NO `role=`, `aria-live`, `border-warning` or amber token.
- The copy grep `contributing — no per-key history yet.` matches with the U+2014
  em dash.
- The `dataSourceKeys` memo references `contributingApiKeyIds` and no longer
  references `eligibleApiKeyIds` (only a comment naming what it moved from).
- `eligiblePerKeyIds` derives from `payload.allocatorEligibleApiKeyIds`.
- `git diff` on the MEMBER-04 regions: the only `perKeyDailiesGateSatisfied`
  lines removed are the three repointed consumers and one dep-array entry. The
  four frozen sites survive at `:1654` (derive), `:1683` (reopen fingerprint),
  `:1867` (openSavedScenario deps), `:1973`/`:1992` (save + update stamps), plus
  `:1840` (ineligible disclosure) and `:2527` (the fallback).

**Mutation falsifiers (both observed first-hand, then reverted; `grep -rn MUTANT`
→ 0).**

1. `canEnterBook` reverted to `hasLiveBook && payload.perKeyDailiesGateSatisfied`
   → **3 failed** (Tests 1, 3, 4). Test 4's failure is the informative one: it
   reddens on its own NON-VACUITY assertion (the session must be in book mode for
   the stamp's `entryMode === "book"` conjunct to be live), proving the freeze pin
   is not passing by accident of blank mode.
2. `eligiblePerKeyIds` narrowed to `payload.contributingApiKeyIds` → **exactly 1
   failed** (Test 10), `expected {} to deeply equal { 'key-b': 2 }`. The stored
   leverage on the not-yet-contributing key was destroyed at Save.

**Fixture honesty.** `partialBook` never hand-sets the old gate: it computes
`allKeys.every(hasSeries)` — the fixture's own `allActiveKeysHavePerKeyDailies`.
Manager keys deliberately DO carry a per-key series (that is what makes them
manager-side) and DO sit in the role-blind `eligibleApiKeyIds`, which is what
makes Tests 5b and 7 non-vacuous.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `perKeyAdapterOutput` narrowed with the rows**

- **Found during:** Task 2, reading the blast radius
- **Issue:** The plan enumerated five `dataSourceKeys` consumers, but
  `perKeyAdapterOutput` (the ENGINE set) reads `payload.eligibleApiKeyIds`
  DIRECTLY, so it was not in that list. Its own comment states the invariant it
  exists to hold: *"blend ONLY eligible keys, the SAME set that gets a toggle row
  (dataSourceKeys below) … without this filter that key would ride the engine
  with no toggle row, letting 'exclude all sources → honest empty' be falsely
  satisfied by an undisclosed, untoggleable source."* Narrowing the rows to
  contributing while leaving the engine on the role-blind eligible set would have
  broken exactly that: a manager key HAS a per-key series and IS in
  `eligibleApiKeyIds`, so it would have blended into the projection with no row,
  no toggle, and no contribution to the `bookEquity` basis the notional column
  reads against.
- **Fix:** narrowed the filter to `contributingApiKeyIds`
  (`allocatorEligible ∩ has-series`), which drops exactly the manager keys and
  nothing else — every contributing key has a series by construction.
- **Test:** AUM-04 Test 5b pins engine-basis === row-basis with 2 manager keys
  present; it was RED before the change.
- **Files modified:** `ScenarioComposer.tsx`
- **Commit:** `1fdfda14`

**2. [Rule 1 - Bug] `eligiblePerKeyIds` decoupled from `usePerKeySources`**

- **Found during:** Task 2, Test 10
- **Issue:** The plan said to keep the prune keep-set on the allocator-eligible
  basis, decoupled from the narrowed `dataSourceKeys` memo. Doing only that left
  Test 10 RED: the memo was ALSO gated `usePerKeySources ? … : []`, and reopening
  a saved book draft syncs the session to BLANK mode (`targetEntryMode` is frozen
  on the old flag), so the keep-set emptied and `pruneLeverageToDraftRefs` dropped
  the override. Reopening is the only route by which an override on a
  row-less key can be in `leverageByRef` at all, so the coupling made the plan's
  own Test 10 unsatisfiable.
- **Fix:** `eligiblePerKeyIds = payload.allocatorEligibleApiKeyIds ?? []`,
  unconditional. A keep-set is a destruction guard, not a display filter — the
  gate's original purpose ("preserve the original stale-dropping behavior
  exactly") was conservatism about STALE refs, and an entry keyed to a live
  allocator key is not stale by construction.
- **Files modified:** `ScenarioComposer.tsx`
- **Commit:** `1fdfda14`

**3. [Rule 3 - Blocking] `ScenarioComposer.save.test.tsx` fell into blank mode**

- **Found during:** Task 1, the allocations-wide sweep
- **Issue:** 8 tests across that file went RED after the repoint. Its
  `makePayload` returns `{…} as MyAllocationDashboardPayload`, and the cast
  suppressed the missing-property error when 151-02 added the three required
  fields — so they arrive `undefined`, which the repointed `?? false` reads as
  "no reachable book". Out of the plan's declared `files_modified`, but a direct
  and unavoidable consequence of the change (the same shape as 151-02's own
  deviation 2, which the typechecker caught for the six literal-built fixtures
  and missed for this cast-built one).
- **Fix:** the same legacy-equivalent derivation added to the main builder.
- **Files modified:** `ScenarioComposer.save.test.tsx`
- **Commit:** `2021ef4d`

### Judgement Calls

**The base fixture reproduces a vacuous gate, deliberately.** 151-02 set the
composer's `makePayload` to `[] / [] / false` and recorded that a hand-set `true`
with zero contributing keys "cannot occur in production". That is correct about
production, but as a DEFAULT it would have dropped ~200 pre-split fixtures into
blank mode the moment `canEnterBook` was repointed. The builder now DERIVES:
`allocatorEligible = eligible`, `contributing = gate ? eligible : []`,
`bookEntryGate = gate` — the pre-split world's own semantics, where every
eligible key is an allocator key. The base fixture's resulting `gate: true` +
`eligible: []` reproduces the OLD flag's own vacuous truth
(`allActiveKeysHavePerKeyDailies([])`), not a claim about production; a comment
says so and points at `perKeyBook` as the real-book helper. Explicit overrides
always win, and the AUM-04 fixtures set all three deliberately.

**Test 2 is a PIN, not a RED.** It passed against the un-repointed composer. It
records the deliberate Open-Q4 narrowing of CONTEXT's "never force-initializes to
blank" — zero contributing keys still initialize blank and keep the calm
fallback note — so a future reading of that CONTEXT line cannot quietly widen it.
Tests 1, 3 and 4 were the genuine REDs.

**Test 10 is a destruction guard, not a RED.** It also passed pre-change (the
keep-set was on the eligible basis already), then went RED under the narrowing
the plan proposed and again under the explicit mutation. Its value is as a
falsifier, and it did its job — it is what surfaced deviation 2.

### Not Deviations

The note is rendered OUTSIDE `CollapsibleSection` rather than as a sibling of
`CompositionList` inside it. "Directly above the per-key data-sources list" is
satisfied either way; inside, a collapsed section would HIDE the note and break
the UI-SPEC "never silent" invariant.

## Deferred Issues

Both logged to `deferred-items.md` in this phase directory:

- **DEF-151-05-A** — `src/__tests__/phase-149-my-strategies-parity.test.ts:522`
  is RED at this plan's BASE commit. The pin greps `deriveStrategylessKeys`'s
  source for the literal `"archived"`, which moved into the extracted
  `deriveStrategyLinkedKeyIds` at 151-02's `d8e5a337`. Behaviour is unchanged
  (151-02's five census tests cover the archived rule at the new location); the
  gate simply did not follow its subject through the refactor. `git diff
  a213591a..HEAD` touches no file in `src/lib` or `src/__tests__`.
- **DEF-151-05-B** — a reopened BOOK draft still lands in BLANK mode under a
  partial book, because `targetEntryMode` stays frozen on the old flag. Newly
  REACHABLE (a partial-book allocator could not author a book draft before this
  plan), but presentation-only: hydration is mode-independent, membership is
  preserved by `memberKeyIdsForUpdate`, and the leverage half is closed by
  deviation 2. Not fixed here because the freeze is a research directive AND an
  explicit acceptance criterion of this plan; the file has two more owners in
  later waves. The item carries the MEMBER-04-neutrality analysis for whoever
  takes it.

## Known Stubs

None. The note's counts are computed from real payload fields on both SSR return
branches; the `?? []` / `?? false` reads are 151-02's declared partial-payload
fallbacks, not placeholders.

## Threat Flags

None. T-151-14 (client re-derive) is mitigated as planned — all three repointed
consumers read `payload.bookEntryGateSatisfied` verbatim and the two narrowed
memos read `payload.contributingApiKeyIds` verbatim; no client-side eligibility
predicate was introduced. T-151-13 (a partial blend presenting as the whole live
book) is mitigated by the diff discipline above plus the fallback reconcile,
which removes the one sentence on this surface that claimed a whole-book blend.

## Self-Check: PASSED

All three claimed files exist on disk and all four claimed commits resolve in
`git log`.

## TDD Gate Compliance

Both tasks ran RED → GREEN with the failure observed before any implementation
(Task 1: 3 failed; Task 2: 7 failed). Task 1's gates are separate `test(...)` then
`feat(...)` commits. Task 2's RED was observed and recorded but shares its commit
with GREEN, because its two files are edited in a single pass and a
source-less intermediate commit would have been an artifact of the ceremony
rather than a checkpoint. No REFACTOR commit was needed.
