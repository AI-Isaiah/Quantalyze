---
phase: 62-explicit-draft-series-membership-schema-v4
plan: 03
subsystem: allocations / scenario share surface
tags: [schema-v4, membership, book-only, share, rls, unification]
requires:
  - "isBookOnlyDraft (null-safe) + memberKeyIds field (62-01 MEMBER-01)"
provides:
  - "share-mint gate reads the SAME null-safe isBookOnlyDraft predicate (one book-only definition across mint/resolve/compare)"
  - "share-resolve book-only detection documented as strategies.length-primary + null-safe (no server-side gate derivation)"
  - "positive memberKeyIds round-trip assertion through get_shared_scenario in the RLS SQL"
affects:
  - "share/route.ts POST mint gate"
  - "scenario-share/[token]/share-resolve.ts book-only branch (comment/contract only)"
  - "test_scenario_shares_rls.sql (additive fixture + assertion)"
tech-stack:
  added: []
  patterns:
    - "unified null-safe predicate at the mint gate; defensive nothing-shareable short-circuits first (null-draft safety)"
    - "additive positive round-trip assertion mirroring the v1.5 window precedent; negative over-return guard byte-intact"
key-files:
  created: []
  modified:
    - "src/app/api/allocator/scenario/share/route.ts"
    - "src/app/api/allocator/scenario/share/route.test.ts"
    - "src/app/scenario-share/[token]/share-resolve.ts"
    - "src/app/scenario-share/[token]/share-resolve.test.ts"
    - "supabase/tests/test_scenario_shares_rls.sql"
decisions:
  - "share-resolve keeps strategies.length === 0 as the PRIMARY book-only detector and does NOT import isBookOnlyDraft: gating the reason on the predicate would break the truly-empty draft (no members) case, which the plan requires to STILL report reason:book-only. The predicate's null-safety is what MAKES the strategies.length-primary approach safe on a pre-v4 undefined-membership share — so share-resolve's change is a contract/comment refinement + regression tests, not a call site. Acceptance criteria confirm this (grep isBookOnlyDraft required only in route.ts; share-resolve required to grep strategies.length===0 + deriveMembershipFromGate=0)."
  - "This is a STRUCTURAL unification, not a behavior change: the pre-existing addedStrategies-empty gate already rejected every book-only draft, so the RED anchor is a source-text assertion (routeSrc contains isBookOnlyDraft), not a behavioral divergence."
requirements: [MEMBER-03]
metrics:
  duration_min: 12
  tasks: 2
  files_modified: 5
  completed: "2026-07-03"
---

# Phase 62 Plan 03: Unified Null-Safe Book-Only Definition (MEMBER-03) Summary

One definition of "book-only" across the share surface: the mint gate now reads the
SAME null-safe `isBookOnlyDraft` predicate the compare/share surfaces use, and the
persisted `memberKeyIds` field is proven to round-trip through `get_shared_scenario`
without tripping the RLS over-return guard. No RPC/SQL migration change.

## What shipped

- **Mint gate unification (Task 1, share/route.ts):** the inline
  `!Array.isArray(draftAdded) || draftAdded.length === 0` book-only check is replaced by
  `nothingShareable || isBookOnlyDraft(draft as ScenarioDraft)`. The defensive
  nothing-shareable path (null / misshapen / empty-added draft) is evaluated FIRST and
  short-circuits, so a `null` draft never reaches the predicate; and because
  `isBookOnlyDraft` is null-safe on undefined `memberKeyIds`, a pre-v4 owner blob returns
  `false` (not a throw) and is still caught by the same defensive branch. The 409 body
  (`{ error, code: "book_only_draft", message }`) is byte-identical. `isBookOnlyDraft` +
  `type ScenarioDraft` imported from `scenario-state.ts`.
- **share-resolve contract (Task 1, share-resolve.ts):** book-only detection stays on the
  resolved `strategies.length === 0` (the PRIMARY detector) returning
  `{ kind:"honest-absence", reason:"book-only" }`. The comment now documents the unified
  null-safe design: a pre-v4 / v2 / v3 share arrives with membership UNDERIVED
  (undefined), so keying the branch on the strategies count (never
  `draft.memberKeyIds.length`) is what keeps such a share honest AND never forces a
  `.length` read off undefined. No server-side gate derivation (grep confirms 0).
- **RLS round-trip (Task 2, test_scenario_shares_rls.sql):** `memberKeyIds`
  (`['11111111-1111-1111-1111-111111111111']`, an api-key UUID — same class as the
  strategy ids already in the payload) seeded into the three scenario fixture drafts
  (scen_a, scen_a_empty, scen_b). Assertion 1 gains a POSITIVE round-trip check
  (`r.draft->'memberKeyIds'->>0` must equal the seed) mirroring the v1.5 window
  precedent. The negative over-return guard regex
  (`api_key|allocated_amount|account_balance|value_usd`) is byte-intact — only additive
  lines around it.

## TDD gates (Task 1)

- RED (`f332628c`): extended both test files; `npx vitest run …` had **1 failing** — the
  `routeSrc` toContain("isBookOnlyDraft") static guard (RED anchor). The behavioral cases
  (T_SH15 book-only-by-membership, T_SH16 pre-v4 undefined-membership no-throw,
  share-resolve v2 undefined-membership no-throw) passed already because this is a
  structural unification, not a behavior change.
- GREEN (`4bca42b7`): mint gate wired to `isBookOnlyDraft`; share-resolve contract
  documented — both files **36/36 green**, `tsc --noEmit` clean.

## Deviations from Plan

### Design decision (documented, not a code deviation)

**1. [Contract] share-resolve does NOT import/call `isBookOnlyDraft`**
- **Why:** The plan's key_link describes the reason "via null-safe isBookOnlyDraft (reason
  only)". But the `reason` type has a single value (`"book-only"`), and the plan also
  requires a truly-empty draft (empty addedStrategies, NO members — where
  `isBookOnlyDraft` returns `false`) to STILL report `reason:"book-only"`. Gating the
  reason on the predicate would therefore break that case. `isBookOnlyDraft`'s null-safety
  is what makes the `strategies.length`-primary detector safe on the pre-v4
  undefined-membership path — that is the unification, realized as a contract/comment +
  regression tests rather than a redundant call site (`strategies.length === 0` is a
  strict superset of `isBookOnlyDraft` here, so an extra call would be dead code, CLAUDE.md
  Rule 2). Acceptance criteria confirm the choice: `isBookOnlyDraft` is grep-required only
  in route.ts; share-resolve is grep-required for `strategies.length === 0` and
  `deriveMembershipFromGate` = 0.

### Auto-fixed Issues

**2. [Rule 3 - Blocking] `as ScenarioDraft` on a membership-omitting fixture failed tsc**
- **Found during:** Task 1 (share-resolve pre-v4 no-throw test)
- **Issue:** the pre-v4 fixture deliberately OMITS `memberKeyIds` (required-at-v4), so
  `as ScenarioDraft` did not overlap (`TS2352`).
- **Fix:** `as unknown as ScenarioDraft` with a comment — a pre-v4 blob genuinely lacks the
  field, which is exactly the underived-membership case under test.
- **Files modified:** share-resolve.test.ts
- **Commit:** 4bca42b7

**3. [Rule 3 - Blocking] acceptance grep `deriveMembershipFromGate` = 0 tripped by a comment**
- **Found during:** post-implementation acceptance verification
- **Issue:** the sole occurrence was the literal identifier inside the explanatory comment
  ("no `deriveMembershipFromGate`"); a naive `grep -c` verifier would read 1, not 0.
- **Fix:** reworded to "must NOT run any gate-based membership derivation here" — the
  intent is preserved, the count is 0.
- **Files modified:** share-resolve.ts
- **Commit:** e1839707

## Verification

- `npx vitest run share/route.test.ts share-resolve.test.ts`: **36 passed / 0 failed**.
  T_SH13/T_SH14 green; T_SH15/T_SH16 (new) green; share-resolve pre-v4 no-throw green.
- `npx tsc --noEmit`: **0 errors**.
- `npx eslint` (4 touched TS files): **0 errors, 0 warnings**.
- Phase-29 frozen-spine guard (`phase-29-frozen-spine-guards.test.ts`): **4 passed** — the
  shares SQL negative over-return guard content pin stays green (additive edit only).
- GUARD-03 frozen zero-diff: `git diff src/lib/scenario.ts src/lib/scenario-window.ts`
  **empty**.
- Acceptance greps: route.ts `isBookOnlyDraft`=4, `book_only_draft`=1; share-resolve.ts
  `deriveMembershipFromGate`=0, `strategies.length === 0`=1; shares SQL `memberKeyIds`=8,
  over-return guard regex byte-intact.
- **RLS SQL:** the positive `memberKeyIds` round-trip assertion is authored; SQL tests run
  in CI against the persistent test project (not locally) — CI is the executor.
- No RPC/SQL migration change (no `schema:functions`, no new migration).

## Threat register

- **T-62-01 (Info disclosure — memberKeyIds in shared draft):** mitigated — member ids are
  the owner's own api-key UUIDs (same class as strategy ids already round-tripping), never
  per-key series; the over-return guard scans the whole payload byte-intact; the positive
  round-trip assertion proves the field carries without tripping it.
- **T-62-06 (book-only dead link):** mitigated — `isBookOnlyDraft` mint gate rejects at
  source (409); share-resolve keeps already-minted links honest via the same predicate's
  resolved-projection counterpart.

## Known Stubs

None. The share surface change is behavior-preserving (structural unification); membership
derivation-on-reopen remains plan 04's job by design.

## Self-Check: PASSED
- All 5 modified files present on disk.
- Commits f332628c, 4bca42b7, 270709fc, e1839707 all exist in git log.
