---
phase: 62-explicit-draft-series-membership-schema-v4
reviewed: 2026-07-03T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/app/(dashboard)/allocations/lib/scenario-state.ts
  - src/app/(dashboard)/allocations/lib/scenario-compare.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx
  - src/app/(dashboard)/allocations/components/ProvenanceNote.tsx
  - src/app/api/allocator/scenario/saved/route.ts
  - src/app/api/allocator/scenario/saved/[id]/route.ts
  - src/app/api/allocator/scenario/share/route.ts
  - src/app/scenario-share/[token]/share-resolve.ts
  - supabase/tests/test_scenario_shares_rls.sql
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: fixed
fix_applied: 2026-07-03
fix_summary:
  WR-01: fixed (3f16cd85)
  WR-02: fixed (560205fb)
  WR-03: fixed (373b075f)
  IN-01: declined (intentional MEMBER-03 shared-predicate; behaviour-preserving; security route)
  IN-02: fixed (25651a89, warning comment)
---

# Phase 62: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** standard
**Files Reviewed:** 10 (8 source + 2 test/SQL substrate)
**Status:** issues_found

## Summary

Phase 62 adds explicit `memberKeyIds` draft membership (schema v3→v4, double bump)
with two non-destructive codec branches, a tolerant decode schema vs a strict
save schema, shared `deriveMembershipFromGate` / `isBookOnlyDraft` / `setMemberKeyIds`
helpers, and a compare/panel membership selector.

The core invariants hold well:
- **localStorage round-trip is non-destructive.** The tolerant `scenarioDraftSchema`
  (memberKeyIds optional, no superRefine) is used on every codec decode branch, and
  `encode` re-serializes an in-memory-upgraded v4 blob (membership absent) that
  decodes back "ok". No path drops an upgraded v2/v3/underived-v4 draft. Verified.
- **STAMP vs DERIVE separation is real.** Save uses the entryMode-aware
  `memberKeyIdsForSave`; reopen/compare use gate-only `deriveMembershipFromGate`
  only when `memberKeyIds === undefined`. A genuine-v4 blank draft (memberKeyIds=[])
  is defined, so it is never re-derived on reopen.
- **Frozen files untouched.** `src/lib/scenario.ts` and `scenario-window.ts` are
  absent from the diff (confirmed).
- **RLS over-return guard byte-intact.** `test_scenario_shares_rls.sql:256` still
  greps `api_key|allocated_amount|account_balance|value_usd`; the new `memberKeyIds`
  round-trip assertions use a UUID that does not match the forbidden set.
- **No `holding:` leakage into membership.** Every membership writer sources
  api-key ids only (`eligibleApiKeyIds`); the per-key compute branch keys on
  api_key_id, never a scope_ref.

No blockers. Three warnings concern honesty divergence in the compare surface and a
misleading/dead interface field; two info items are redundant/latent-trap code.

## Warnings

### WR-01: Blank-authored draft inherits the full live book's holdings in the compare column

**Status:** FIXED (commit 3f16cd85). The holdings else-branch now feeds
`opts.liveBook ? liveInputs.holdingsSummary : []`, so a saved draft with empty
membership computes added-only and only the live-book own-book column blends the
live holdings. A NON-EMPTY-holdings F5 regression was proved RED first; the
holdings-vehicle engine pins were rebased onto per-key membership (saved-book
behaviour) and `{ liveBook: true }` (own-book column).

**File:** `src/app/(dashboard)/allocations/lib/scenario-compare.ts:165-213`
(with `ScenarioComparePanel.tsx:184` feeding the full `payload.holdingsSummary`)

**Issue:** For a blank-authored saved draft (`memberKeyIds: []`, defined), `usePerKeySources`
is false, so compute takes the else-branch `buildStrategyForBuilderSet(liveInputs.holdingsSummary, …)`.
`deriveCompareInputs` always passes the **complete** live `payload.holdingsSummary`
(line 184), and the overlay loop defaults any holding ref not present in the draft's
`toggleByScopeRef` to `selected = true` (`toggle === undefined ? (state.selected[s.id] ?? true) : toggle`).
A blank draft never seeded holding toggles, so **every live holding is selected** and the
compare column blends the live book's holdings — even though the composer rendered that
same blank draft with `holdingsSummary = []` (added-strategies only). This contradicts the
phase's F5 invariant ("a blank-authored draft … computes the added-only path … never inherits
the live book"). The F5 closure test (`scenario-compare.test.ts:626`) only proves the claim
with `holdingsSummary: []` in `perKeyInputs`, which masks the non-empty prod shape.

**Fix:** Gate the else-branch's holdings on membership intent, or add a test with a
non-empty `holdingsSummary` and a blank draft asserting `member_count`/holdings are
excluded. Concretely, a blank draft should compute added-only regardless of the inputs'
holdings:
```ts
// else-branch: a memberKeyIds=[] draft is book-less → do not blend live holdings.
const holdingsForDraft = (draft.memberKeyIds ?? []).length === 0 && draft.addedStrategies.length >= 0
  ? [] // added-only: blank draft must not inherit live holdings
  : liveInputs.holdingsSummary;
adapterOutput = buildStrategyForBuilderSet(holdingsForDraft, disabledHoldingRefs, draft.addedStrategies, …);
```
(Confirm the desired semantics first — if holdings-inclusion for a blank draft is
actually intended, the F5 doc/comment in `scenario-compare.ts` is wrong and should be
corrected instead.)

### WR-02: Live-book compare column ignores `perKeyDailiesGateSatisfied`, diverging from the composer baseline and from sibling columns

**Status:** FIXED (commit 560205fb). `buildLiveBookDraft(gate, eligible)` now
threads the real gate into `deriveMembershipFromGate`, and the panel passes
`payload.perKeyDailiesGateSatisfied`. Gate off ⇒ empty membership ⇒ holdings
union path (matching sibling columns); gate on ⇒ per-key blend. A gate-respect
regression was added; the Atlas golden + P61/T_CP8 blocks (all gate=true) are
byte-unmoved.

**File:** `src/app/(dashboard)/allocations/lib/scenario-compare.ts:313-333` (`buildLiveBookDraft`)
and `ScenarioComparePanel.tsx:286-302`

**Issue:** `buildLiveBookDraft` stamps `memberKeyIds = deriveMembershipFromGate(true, eligibleApiKeyIds)`
— gate hardcoded `true`. `computeMetricsForDraft` then selects per-key sources whenever
`memberKeyIds.length > 0`, i.e. whenever any eligible key exists, **regardless of
`perKeyDailiesGateSatisfied`**. But (a) the composer's own live baseline respects the gate
(per-key only when satisfied, else holdings), and (b) the panel normalizes *underived* saved
columns with `deriveMembershipFromGate(payload.perKeyDailiesGateSatisfied ?? false, …)`
(`ScenarioComparePanel.tsx:262`). So when the gate is **false** with eligible keys present,
the "Live book" column runs the per-key basis (or, if `perKeyReturnsByApiKeyId` is empty
because the gate is off, degenerates to NULL metrics — the dead-em-dash class P61-BUG-2
was meant to kill) while sibling columns run the holdings basis. Inconsistent basis within
one table, and a possible live-book em-dash on an otherwise healthy book.

**Fix:** Thread the real gate into the live-book draft so it matches the composer and the
sibling columns:
```ts
// ScenarioComparePanel.tsx
buildLiveBookDraft(
  (payload.perKeyDailiesGateSatisfied ?? false) ? (payload.eligibleApiKeyIds ?? []) : [],
)
```
or have `buildLiveBookDraft` take the gate and call `deriveMembershipFromGate(gate, eligible)`.

### WR-03: `perKeyDailiesGateSatisfied` on `ScenarioCompareInputs` is documented as the channel selector but is never read

**Status:** FIXED (commit 373b075f, doc-correction resolution). The JSDoc now
states the real contract: the field is carried for payload parity only,
`computeMetricsForDraft` does NOT read it, membership (`memberKeyIds`) is the
selector, and the gate is consulted solely at the panel boundary (underived-
column derivation + `buildLiveBookDraft` gate stamp, WR-02). Chose doc-correction
over field removal: removal would touch the `deriveCompareInputs` writer and
several test fixtures for no behaviour change, and parity with the payload shape
has documentation value. No misleading doc remains.

**File:** `src/app/(dashboard)/allocations/lib/scenario-compare.ts:96-111`

**Issue:** The field's JSDoc says "When `perKeyDailiesGateSatisfied` is true the draft
computes on PER-KEY units … Absent → the legacy holdings path runs unchanged." But
`computeMetricsForDraft` never reads `liveInputs.perKeyDailiesGateSatisfied` (confirmed by
grep — only the interface declaration and comment reference it). The actual selector is
`(draft.memberKeyIds ?? []).length > 0`. The field is dead weight and the contract is
misleading: a maintainer wiring compute off this flag per the doc would be wrong, and it
obscures WR-02 (the gate really is dropped on the compute path).

**Fix:** Either remove the field and its comment, or correct the doc to state that the
gate is applied upstream (panel normalization + `buildLiveBookDraft` derivation) and is
NOT consulted inside `computeMetricsForDraft`.

## Info

### IN-01: Redundant `isBookOnlyDraft` clause in the share-mint gate

**Status:** DECLINED. The redundancy is intentional: the route's MEMBER-03
comment (share/route.ts:194-199) documents `isBookOnlyDraft` as the ONE shared
book-only predicate used across mint/resolve/compare, and the reviewer confirms
"Not a bug (the gate is correct)". Dropping the clause would (a) remove the
shared-predicate usage the MEMBER-03 design mandates, (b) leave an unused import
to strip and detailed gate comments to rewrite, and (c) touch a security-
sensitive share route for ZERO behaviour change. Not trivially safe under the
Info-scope "apply only if trivially safe" bar; deletion also falls under the
dead-code-approval gate. Left as-is.

**File:** `src/app/api/allocator/scenario/share/route.ts:200-213`

**Issue:** `nothingShareable = !Array.isArray(draftAdded) || draftAdded.length === 0`
already short-circuits the OR whenever `addedStrategies` is empty. `isBookOnlyDraft` returns
true only when `addedStrategies.length === 0` (plus `memberKeyIds >= 1`) — a strict subset of
`nothingShareable`. So `nothingShareable || isBookOnlyDraft(...)` can never let
`isBookOnlyDraft` change the outcome; the clause is dead. Not a bug (the gate is correct),
but the extra predicate implies a discriminating check that does not exist.

**Fix:** Drop the `|| isBookOnlyDraft(...)` clause (the `nothingShareable` check is
sufficient), or keep only if a future book-with-added case must be rejected — in which case
`nothingShareable` must be loosened, not the OR.

### IN-02: `loadScenarioDraft` back-compat helper silently drops upgraded v2/v3/underived-v4 blobs

**Status:** FIXED (commit 25651a89, minimal comment resolution). Added a
prominent JSDoc warning that the helper is DESTRUCTIVE on pre-v4 blobs (silently
nulls upgraded v2/v3/underived-v4 drafts), has no production caller (tests only),
and MUST NOT be used on the reopen/hydrate path — route hydration through
`scenarioDraftCodec`. Chose the comment over deletion: the helper has live test
callers and deletion falls under the dead-code-approval gate. Comment-only, no
behaviour change.

**File:** `src/app/(dashboard)/allocations/lib/scenario-state.ts:956-968`

**Issue:** `loadScenarioDraft` returns `null` when `parsed.schema_version !== SCENARIO_SCHEMA_VERSION`
(i.e. any v2/v3/version-ahead blob), the opposite of the codec's non-destructive upgrade
branches. It is currently unused in production (grep: only the definition), so no live drop
occurs. But it is exported and marked "retained for back-compat"; any future reuse would
re-introduce exactly the silent-drop-of-upgraded-drafts blocker the codec branches exist to
prevent.

**Fix:** Delete the unused helper, or route it through `scenarioDraftCodec` so it shares the
non-destructive trichotomy. At minimum, add a comment flagging that it drops pre-v4 drafts
and MUST NOT be used on the reopen/hydrate path.

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
