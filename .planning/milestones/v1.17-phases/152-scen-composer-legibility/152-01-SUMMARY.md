---
phase: 152-scen-composer-legibility
plan: 01
subsystem: api
tags: [nextjs, route-handler, supabase, postgrest, rls, pseudonymity, vitest]

# Dependency graph
requires:
  - phase: 110 (CONTRIB-03)
    provides: "owner-inclusive browse via withPublishedOrOwner + the isOwnRow ownership bit at route.ts:220"
  - phase: 29 (UNIFY-03)
    provides: "the additive-co-fetched-key precedent (is_example) this plan copies verbatim"
provides:
  - "GET /api/strategies/browse emits isOwn: boolean on EVERY row (uniform, strict boolean)"
  - "created_at + status emitted on OWN rows only, key ABSENT (not undefined) elsewhere"
  - "H-0300 fence restructured into TWO exhaustive arms (ALLOWED_THIRD_PARTY / ALLOWED_OWN)"
  - "whole-payload sweep proving another owner's created_at reaches no part of the response"
affects: [152-02, 152-03, StrategyBrowseDrawer, scenario-state, scenario composer Yours chip, browse dedup line]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "two-arm exhaustive wire fence for a non-uniform response shape"
    - "single-key conditional object spread for absent-vs-undefined key emission"

key-files:
  created: []
  modified:
    - src/app/api/strategies/browse/route.ts
    - src/app/api/strategies/browse/route.test.ts

key-decisions:
  - "isOwn is emitted on EVERY row including false — a viewer-relative relationship, not the other owner's metadata; a uniform key makes a missing chip downstream a render bug rather than a silent wire drop"
  - "created_at/status use single-key conditional spreads so the key is ABSENT on third-party rows, matching the fence arms BEFORE serialization rather than relying on JSON.stringify dropping undefined"
  - "The H-0300 fence became two exhaustive arms rather than one widened ALLOWED list: appending keys to a shared list would pass the test AND permit the owner metadata on third-party rows in the same edit"
  - "status crosses the wire as the raw DB enum; the client product-cases it rather than the route inventing a second vocabulary"

patterns-established:
  - "Two-arm fence: when a wire shape is conditional on viewer identity, the key-set fence must be split per arm — never a single list with optional members"
  - "Absent-not-undefined: conditional emission uses `...(cond ? { k: v } : {})`, one named key per spread, so the named-key fence is preserved"

requirements-completed: [SCEN-02, SCEN-05]

# Metrics
duration: 12min
completed: 2026-08-07
---

# Phase 152 Plan 01: Browse wire — isOwn + own-only disambiguation metadata Summary

**`GET /api/strategies/browse` now puts the already-computed server-side ownership bit on the wire as `isOwn` (uniform, every row) and emits `created_at`/`status` on the caller's own rows only, behind an H-0300 fence split into two exhaustive arms.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-07T19:03:00Z
- **Completed:** 2026-08-07T19:15:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- `isOwn: boolean` on every browse row, reusing `isOwnRow` (`route.ts:220`) rather than recomputing — the rendered "Yours" chip and the un-redacted own-row name can never disagree, because they read the same bit.
- `created_at` / `status` co-fetched and emitted **only** when `isOwn === true`; the key is absent (not `undefined`) on third-party rows, so the emitted object matches the fence arms before serialization.
- The single `ALLOWED` array of H-0300a is gone. In its place: `ALLOWED_THIRD_PARTY` (7 keys) and `ALLOWED_OWN` (9 keys), each an exhaustive `Object.keys(...).sort()).toEqual(...)`. The "just add the new keys to the list" fix is now structurally impossible without a red test.
- Whole-payload sweep with a distinctive third-party `created_at` (`1999-01-01T00:00:00.000Z`) proves another owner's creation date appears nowhere in `JSON.stringify(body)` — the claim a key-set check cannot make.
- RED was observed first-hand before any route edit: all four new tests failed on key-set mismatch naming `isOwn`, with 27/27 pre-existing tests green.

## Task Commits

1. **Task 1: Restructure H-0300 into two exhaustive arms + isOwn/own-only emission tests (RED)** — `3d6b4735` (test)
2. **Task 2: Emit isOwn on every row + created_at/status on own rows only (GREEN)** — `646239b3` (feat)

No REFACTOR commit — the GREEN implementation is four additive edits with nothing to clean up.

## Files Created/Modified

- `src/app/api/strategies/browse/route.ts` — SELECT gains `created_at, status`; row cast declares both; emit literal gains `isOwn: isOwnRow` plus two single-key conditional spreads; `BrowseStrategyRow` gains `isOwn: boolean`, `created_at?: string`, `status?: string`, each TSDoc'd in the `is_example` voice (phase/requirement id, what a value means, what absence means, why it is not a disclosure widening).
- `src/app/api/strategies/browse/route.test.ts` — H-0300a replaced by four tests: two exhaustive fence arms, an `isOwn` strict-boolean emission test, and an own-only-fields test. `seedOwnAndThirdPartyRows()` helper carries the two-row own-vs-other fixture (T12f shape) with both rows populating `created_at`/`status` so the conditional emission is observable. H-0300b untouched.

## Decisions Made

- **`isOwn` on third-party rows is `false`, not omitted.** An optional member would let a consumer read `undefined` as "not yours" without ever knowing the field was absent, and it would make a wire drop indistinguishable from a correct negative. The value is a viewer-relative *relationship*; it discloses nothing the viewer does not already know.
- **`created_at` is withheld from third-party rows because it is a correlation vector**, not merely because it is uninteresting: it pins when a given codename first appeared, which the codename exists to hide. Both the SELECT comment and the fence-arm comment state this so a future reader does not read the omission as an oversight.
- **`status` ships raw** (`draft` / `pending_review` / `published` / `archived` / `private`). Product-casing it in the route would create a second vocabulary the client would then have to reverse.
- **No `key_count`, no second query, no PostgREST embed** — D-1 as adopted in the plan. The third-party fence arm carries an explicit `not.toHaveProperty("key_count")` so a later "just add key_count" edit reddens.

## Deviations from Plan

None — plan executed exactly as written. Two acceptance criteria required interpretation rather than change:

- **`grep -c '\.\.\.row' route.ts` returns 0** — it returns **2**, and both hits are *prose*: the pre-existing H-0300 fence comment (`// H-0300 fence: explicit named key (NOT a '...row' spread)`, present before this plan) and the new SCEN-05 comment that explains why a single-key conditional spread is not a row spread. The criterion was already unsatisfiable at its literal reading before this plan touched the file. The honest form was verified instead: `grep -n '\.\.\.'` on the route returns exactly three lines — the pre-existing `NO_STORE_HEADERS` header spread and the two single-key conditional spreads. **Zero row/`r` spreads in code.**
- **"the string `expect.objectContaining` does not appear in any H-0300 test"** — a bare `grep -c` returns 2, both at `route.test.ts:538-539` in the unrelated Sentry-capture 500-path test. None in any H-0300 test. Criterion holds as written.

## Issues Encountered

- The worktree spawned on a base 1 commit behind `0a00e8e0` (the `<worktree_branch_check>` reset corrected it) and with **no `node_modules`** — symlinked to the main checkout per the spawn instructions rather than re-installing.

## Threat Flags

None. No new network endpoint, auth path, file access, or schema change. `T-152-01-01` (third-party `created_at` disclosure) is mitigated as planned by the own-only conditional emission plus the two fence arms and the whole-payload sweep; `T-152-01-03` is untouched — the SELECT still runs on the user-scoped `createClient()` through `withPublishedOrOwner`, with no new query and no new error path.

## Known Stubs

None.

## Verification

- `npx vitest run src/app/api/strategies/browse/route.test.ts --no-file-parallelism` → **31 passed (31)**, 1 file passed.
- `npx eslint src/app/api/strategies/browse/route.ts src/app/api/strategies/browse/route.test.ts` → clean (`quantalyze/no-raw-published-predicate` untriggered).
- `npx tsc --noEmit` → clean. `BrowseStrategyRow` has no consumer outside the route and its test, so the newly-required `isOwn` breaks no construction site.
- RED evidence (pre-Task-2): `4 failed | 27 passed (31)`, the two fence arms failing on `expected [ Array(6) ] to deeply equal [ 'codename', 'id', 'isOwn', …(4) ]`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The wire is landed first by design: every downstream render (the composer "Yours" chip, the browse dedup line) is now a pure projection of this payload, so a missing chip in 152-02/03 is a render bug, not a silent wire drop.
- ⚠️ Consumers to wire next: `StrategyBrowseDrawer.tsx` (local row interface — add `isOwn?: boolean`, `created_at?: string`, `status?: string` per PATTERNS `:654`) and `scenario-state.ts` (`isOwn` goes on the **nested** schema at `:845-850`, not the top-level draft schema).
- ⚠️ PATTERNS Pitfall: `browseOnAdd` captures the LAST-RENDERED drawer mount, so an "all seams carry `isOwn`" test must run twice with different payloads. CONTEXT locks "never fabricate ownership" — leave `isOwn` **absent** rather than defaulted where the source cannot supply it.

## Self-Check: PASSED

- `src/app/api/strategies/browse/route.ts` — FOUND
- `src/app/api/strategies/browse/route.test.ts` — FOUND
- `.planning/phases/152-scen-composer-legibility/152-01-SUMMARY.md` — FOUND
- Commit `3d6b4735` — FOUND
- Commit `646239b3` — FOUND

---
*Phase: 152-scen-composer-legibility*
*Completed: 2026-08-07*
