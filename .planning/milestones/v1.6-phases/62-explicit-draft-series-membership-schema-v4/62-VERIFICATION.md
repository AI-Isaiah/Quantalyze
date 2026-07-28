---
phase: 62-explicit-draft-series-membership-schema-v4
verified: 2026-07-03T14:35:00Z
status: passed
score: 5/5 success criteria verified (MEMBER-01..04 all satisfied)
overrides_applied: 0
---

# Phase 62: Explicit Draft Series Membership (schema v4) Verification Report

**Phase Goal:** Saved scenario drafts are self-describing about which series they blend — membership is a persisted per-key id list, not inferred from the runtime gate or the ephemeral `entryMode`.
**Verified:** 2026-07-03T14:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | v4 draft round-trips `memberKeyIds` (save POST/PUT + codec + share JSONB + RLS round-trip assertion) | VERIFIED | `saved/route.ts:62` + `saved/[id]/route.ts:84` both validate `draft: scenarioDraftSaveSchema` (v4-membership superRefine at save boundary). Codec exact-v4 branch (`scenario-state.ts:833`) adopts `ok`. RLS SQL `test_scenario_shares_rls.sql` seeds `memberKeyIds` (8 hits) with a positive `r.draft->'memberKeyIds'->>0` round-trip assertion; over-return guard regex byte-intact (3 hits). |
| 2 | v3 AND v2 drafts decode `ok` (`upgraded_v3_membership` / `upgraded_v2_chain`), never reset; upgraded working draft survives encode→decode | VERIFIED | Codec branches `scenario-state.ts:865` (v3→`upgraded_v3_membership`) and `:896` (literal `rawVersion === 2`→`upgraded_v2_chain`), both `safeParse`-then-spread non-destructive, before the final reset (`:916`). Shared `scenarioDraftSchema` has NO `.superRefine` (only 1 real superRefine call at `:767` on the save schema; other 3 grep hits are comments) → tolerant decode. Round-trip regression + 96 codec/state tests GREEN. |
| 3 | Compare: blank-authored draft NEVER merges live book; `entryMode` not load-bearing for saved drafts | VERIFIED | Selector `usePerKeySources = (draft.memberKeyIds ?? []).length > 0` (`scenario-compare.ts:175`) — membership, not the gate. WR-01 else-branch fix `holdingsForDraft = opts.liveBook ? liveInputs.holdingsSummary : []` (`:222`). **Falsified:** neutering line 222 makes the non-empty-holdings F5 test (`scenario-compare.test.ts:700`, member_count expected 0) FAIL with member_count 2; restored → passes. |
| 4 | One book-only definition: `isBookOnlyDraft` consumed by the mint gate; share-resolve stays on `strategies.length===0` (documented contract split) | VERIFIED | Mint gate `share/route.ts:203` `nothingShareable \|\| isBookOnlyDraft(draft as ScenarioDraft)`, 409 `book_only_draft` byte-intact. share-resolve keeps `strategies.length === 0` primary (`:214`), documents `isBookOnlyDraft` as its resolved-projection counterpart in comments (`:200,:212`), `deriveMembershipFromGate` count 0. Intentional split (62-03 SUMMARY + review IN-01 declined) — a truly-empty no-member draft must still report `book-only`, which the predicate would return false for. |
| 5 | Ineligible-member reopen disclosure via ephemeral note (no cross-tab key), recompute disclosed not silent | VERIFIED | `ScenarioComposer.tsx:1327-1331` computes `droppedMembers` from RAW `decoded.value.memberKeyIds` ∩ `eligibleApiKeyIds`, `setShowMembershipNote(droppedMembers.length > 0)`. Renders distinct `scenario-membership-note` with locked copy (`:3356-3360`). `ProvenanceNote.tsx` cross-tab/localStorage count 0 (ephemeral). Recompute proceeds visibly (compute-time intersection at `scenario-compare.ts:187-190`). 204 composer/provenance/share tests GREEN. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scenario-state.ts` | v4 field, tolerant codec, save schema, 3 helpers, 2 non-destructive branches | VERIFIED | `SCENARIO_SCHEMA_VERSION=4`/`_PREV=3`, `memberKeyIds:string[]`, `deriveMembershipFromGate`/`isBookOnlyDraft`(null-safe)/`setMemberKeyIds` all exported; `scenarioDraftSaveSchema` superRefine at save boundary only |
| `scenario-compare.ts` | membership selector + `buildLiveBookDraft(gate, eligible)` + WR-01/WR-03 | VERIFIED | selector reads `draft.memberKeyIds`; `buildLiveBookDraft(perKeyDailiesGateSatisfied, ...)` threads real gate (WR-02); WR-03 doc correction at `:112` |
| `ScenarioComparePanel.tsx` | eligible+gate into `buildLiveBookDraft`, derive underived columns | VERIFIED | `:290-292` gate+eligible; `:258-267` normalizes every underived column via derive+stamp before compute |
| `share/route.ts` | null-safe `isBookOnlyDraft` mint gate | VERIFIED | imported `:58`, used `:203` |
| `test_scenario_shares_rls.sql` | additive memberKeyIds round-trip, guard intact | VERIFIED | 8 memberKeyIds hits, guard regex 3 hits unchanged |
| `ScenarioComposer.tsx` | entryMode-aware STAMP + reopen derive + disclosure | VERIFIED | STAMP `:1441-1444` (entryMode-aware, NOT derive); reopen `hydratedValue` derive-and-stamp `:1225-1234`; disclosure `:1327-1331` |
| `ProvenanceNote.tsx` | parameterized message/action, ephemeral | VERIFIED | 0 cross-tab keys |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| codec.decode | v3 + literal-2 branches | rawVersion trichotomy | WIRED (`:865`, `:896`) |
| scenarioDraftSaveSchema | saved POST + PUT body-validate | superRefine schema_version>=4 | WIRED (`route.ts:62`, `[id]/route.ts:84`) |
| computeMetricsForDraft | draft.memberKeyIds ∩ eligible | usePerKeySources + intersection | WIRED (`:175`, `:187-190`) |
| composer save sites | setMemberKeyIds(draft, entryMode-aware ids) | both POST/PUT bodies | WIRED (`:1457`, `:1500`) |
| reopen | deriveMembershipFromGate + setMemberKeyIds into working state | hydratedValue | WIRED (`:1225-1234`, consumed at `:1238` + `:1277`) |
| reopen ineligible | showMembershipNote from droppedMembers | eligibleApiKeyIds diff | WIRED (`:1327-1331`) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Codec + helpers + selector | vitest scenario-compare + scenario-state | 96 passed | PASS |
| Composer stamp/reopen/disclosure + share | vitest composer/provenance/share/share-resolve | 204 passed | PASS |
| F5 regression genuinely encodes WR-01 fix | neuter line 222 → run F5 test | 1 failed (member_count 2 vs 0); restored → pass | PASS (falsified) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MEMBER-01 | 62-01 | Persist series membership as explicit per-key id list; v3→v4 non-destructive upgrade | SATISFIED | field + double bump + tolerant codec + v3/v2 branches + save schema + 3 helpers |
| MEMBER-02 | 62-02 | Compare distinguishes blank vs book by persisted membership; entryMode not load-bearing | SATISFIED | membership selector + WR-01 fix + F5 falsified |
| MEMBER-03 | 62-03 | Mint gate + share-resolve share one book-only definition | SATISFIED | isBookOnlyDraft mint gate + documented resolve split + RLS round-trip |
| MEMBER-04 | 62-04 | Reopen with ineligible member DISCLOSES the drop (never silent recompute) | SATISFIED | entryMode-aware stamp + reopen derive + ephemeral disclosure note |

No orphaned requirements: REQUIREMENTS.md maps exactly MEMBER-01..04 to Phase 62; all four claimed by plans.

### Anti-Patterns Found

None. Modified source files scanned for `TBD`/`FIXME`/`XXX` (0) and `placeholder`/`not implemented` (0). GUARD-03 frozen zero-diff: `git diff origin/main..HEAD -- src/lib/scenario.ts src/lib/scenario-window.ts` empty (0 lines).

### Human Verification Required

None manufactured. Authed-prod behavior of the purified surfaces (book blend, blank mode, save→reopen membership round-trip, compare columns, share mint/resolve, membership-note visual) is Phase 65's canary GUARD-04 by design. The RLS SQL round-trip assertion executes in CI against the persistent test project (authored + present here); that is a CI-executor item, not a human item.

### Gaps Summary

No gaps. All five success criteria are observably true in the codebase, all three code-review warnings (WR-01/02/03) and IN-02 are fixed and present, the F5 regression genuinely fails without the WR-01 fix (Rule 9 satisfied), and the frozen engine is zero-diff. The phase goal — saved drafts self-describing via persisted per-key membership rather than the runtime gate or ephemeral entryMode — is achieved.

---

_Verified: 2026-07-03T14:35:00Z_
_Verifier: Claude (gsd-verifier)_
