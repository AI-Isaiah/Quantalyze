# Phase 151 — deferred items

Out-of-scope discoveries logged during execution. Per the SCOPE BOUNDARY rule
these were NOT fixed: they are outside the discovering plan's declared
`files_modified` and are not caused by its own changes.

---

## DEF-151-05-A — `phase-149-my-strategies-parity` pin 8 is RED on main (owner: 151-02 / phase close)

**Found during:** 151-05 Task 2 verification (wider grep-gate sweep)
**Status:** pre-existing at 151-05's base commit `a213591a`; NOT caused by 151-05
**File:** `src/__tests__/phase-149-my-strategies-parity.test.ts:522`
**Cause:** `src/lib/queries.ts` @ `d8e5a337` (151-02 Task 1)

The NAV-01 parity gate greps the SOURCE TEXT of `deriveStrategylessKeys` and
asserts it contains the literal `"archived"` (W-4: an owner-archived strategy
must not count as coverage, so its key reappears as a placeholder candidate).

151-02 extracted the covered-set construction into the shared
`deriveStrategyLinkedKeyIds`, and the `"archived"` literal went with it.
`deriveStrategylessKeys` now delegates, so its body no longer contains the
string — the gate reddens even though the BEHAVIOUR is unchanged (151-02's
no-drift pin proves `deriveStrategylessKeys` still returns exactly the two bare
keys, and its five census tests cover the archived rule at the new location).

This is a source-scanning gate that did not follow its subject through a
refactor — the same silent-narrowing failure mode the gate family exists to
catch, in the opposite direction (false RED, not false GREEN).

**Suggested remedy:** repoint pin 8 at `deriveStrategyLinkedKeyIds` (where the
archived rule now lives) and keep a delegation assertion on
`deriveStrategylessKeys`, so the pair cannot drift apart again. One-line-ish;
do NOT "fix" it by re-inlining the literal into the delegating wrapper.

**Blast radius:** one always-red test in `src/__tests__`. `npm run typecheck`
and `npm run lint` are clean; the whole `src/app/(dashboard)/allocations` suite
(122 files / 1694 tests) is green.

---

## DEF-151-05-B — a reopened BOOK draft still lands in BLANK mode under a partial book (owner: phase close / 151-06+)

**Found during:** 151-05 Task 2, writing Test 10
**Status:** presentation-only; the data-integrity half was CLOSED inside 151-05
**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
(`targetEntryMode`, the reopen mode-sync — a consumer 151-05's plan freezes on
the OLD all-or-nothing flag by RESEARCH directive, Pitfall 3)

`openSavedScenario` decides the mode a reopened draft lands in with
`draftIsBookAuthored && payload.perKeyDailiesGateSatisfied`. 151-05 repointed
book ENTRY to the split gate but left this frozen as directed, so a partial-book
allocator who saves a book draft and reopens it lands in BLANK mode: the composer
gates `holdingsSummary` to `[]` and their book rows do not render.

The code comment justifying the freeze is now stale: it reasons that "book is
only representable when the per-key gate is satisfied (it needs a per-source
engine)" — which the split gate has made false. A partial book HAS a per-source
engine (over the contributing keys).

**Reachability is NEW.** Before 151-05 a partial-book allocator was always in
forced-blank, so they could never author a book draft in the first place. They
can now.

**Not data loss.** `hydrateFromSaved` runs regardless of mode, so the saved
draft's contents round-trip; `memberKeyIdsForUpdate` still preserves persisted
membership; and 151-05 moved the leverage prune keep-set onto
`allocatorEligibleApiKeyIds`, decoupled from `usePerKeySources`, precisely so
this blank-mode reopen cannot silently drop saved per-key leverage (AUM-04
Test 10, with an observed mutation falsifier). The residue is presentational and
is the state CR-01 case (a) already pins.

**Why not fixed here:** the freeze is a RESEARCH directive and an explicit
151-05 acceptance criterion ("`git diff` shows ZERO changes on the MEMBER-04
lines"). Unilaterally repointing a plan-frozen consumer from a parallel worktree
— with 151-06/07 landing on this same file in later waves — is the
average-two-conflicting-directives failure. Surfaced instead.

**Analysis for whoever picks it up:** repointing `targetEntryMode` to
`bookEntryGateSatisfied` appears MEMBER-04-neutral in all three regimes —
partial book (stamp stays `[]` because the OLD flag is false; Update still
preserves), both-gates-true (unchanged), zero-contributing (blank either way).
The drift decision is also unchanged for book-authored drafts, since
`liveBookFingerprint` is already the second predicate arm. Verify that analysis
before acting on it.
