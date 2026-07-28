---
phase: 29-unified-composer-spine
plan: 02
subsystem: api/strategies/browse
tags: [unify-03, catalog-merge, rls, pseudonymity, is_example]
requires:
  - withPublishedOnly (src/lib/visibility.ts)
  - displayStrategyName (src/lib/strategy-display.ts)
provides:
  - "BrowseStrategyRow.is_example boolean on GET /api/strategies/browse (UNIFY-03 server half)"
  - "merged verified + example catalog metadata under the locked RLS + withPublishedOnly + displayStrategyName contract"
affects:
  - Plan 29-03 (StrategyBrowseDrawer renders the Example pill off is_example)
  - Plan 29-04 (composer wires example-add via the lazy returns route + this tag)
tech-stack:
  added: []
  patterns:
    - "co-fetched flag (is_example) drives a client tag — NOT a published-bypassing .or"
    - "explicit allow-list projection (H-0300 fence) extended by one named key"
    - "non-vacuous leak test: ABSENCE sweep + positive control"
key-files:
  created: []
  modified:
    - src/app/api/strategies/browse/route.ts
    - src/app/api/strategies/browse/route.test.ts
decisions:
  - "is_example is a co-fetched column appended to the existing SELECT, not a second query or a .or() that would bypass withPublishedOnly — example rows are published rows that ALSO carry the flag"
  - "displayStrategyName runs on example rows exactly as on verified rows; the provenance tag never reintroduces a raw-name leak"
  - "H-0300a allow-list extended to include is_example as a named key; the forbidden-key fence (disclosure_tier / backtest_returns / user_id absence) stays exhaustive and intact"
metrics:
  duration_min: 4
  tasks: 2
  files: 2
  tests_total: 25
  completed: 2026-06-23
---

# Phase 29 Plan 02: Merged Catalog (is_example) Summary

One-liner: `GET /api/strategies/browse` now co-fetches and emits `is_example` so the unified Browse drawer lists verified + example-universe strategies in one RLS-scoped, pseudonymity-safe response — under the locked `withPublishedOnly` + `displayStrategyName` contract, with a non-vacuous leak/pseudonymity guard.

## What Was Built

**Task 1 (`feat(29-02)` — `df10edaf`):** Extended the browse route's metadata-only catalog read to tag example-universe rows.
- Added `is_example: boolean` to the exported `BrowseStrategyRow` wire type.
- Appended `is_example` to the existing `.select(...)` column list on the SAME `withPublishedOnly`-wrapped, RLS-scoped query (NOT a `.or(is_example.eq.true)` and NOT a second query — example rows are just published rows that also carry the flag).
- Read `r.is_example` from the typed row cast and emitted `is_example: r.is_example === true` as a NAMED key in the explicit allow-list projection (H-0300 fence preserved — no `...row` spread). `name` still flows through `displayStrategyName(...)` for example rows exactly as for verified rows.
- The response stays metadata-only (no `daily_returns` — the heavy series is the lazy route from Plan 01).
- Updated the existing H-0300a `ALLOWED` allow-list to include `is_example` (necessary contract update so the route change stays green; the forbidden-key fence remains exhaustive).

**Task 2 (`test(29-02)` — `d3157f0a`):** Added the non-vacuous merged-catalog leak + pseudonymity test.
- `T29-merge`: seeds a published EXAMPLE row (exploratory tier, real name "Renaissance Medallion", codename "Sigma-7", `is_example:true`) alongside a published VERIFIED institutional row (`is_example:false`). Asserts both surface in ONE response; the published predicate (`observedFilters.status === "published"`) is STILL enforced with `is_example` co-fetched; `is_example` is in the SELECT list; the tag is discriminating (example `true` / verified `false`); the example row's response `name` === its codename "Sigma-7"; and the whole-payload `JSON.stringify(body)` sweep contains neither "Renaissance" nor "Medallion" (mirrors T12a verbatim).
- `T29-merge-control` (non-vacuity positive control): asserts the raw name IS present in the seeded source row's `name` field but ABSENT from the serialized response — proving the absence assertion can fail if `displayStrategyName` were bypassed.

## Verification

- `npx vitest run src/app/api/strategies/browse/route.test.ts` — **25 passed** (23 pre-existing + 2 new). All T12a-e pseudonymity cases and H-0300a/b allow-list fences stay green.
- `git diff --exit-code src/lib/scenario.ts` — **clean** (frozen engine untouched, SCENARIO-05 honored).
- `git status --porcelain supabase/migrations/` — **empty** (no migration this phase).
- `grep -c createAdminClient src/app/api/strategies/browse/route.ts` — **0** (RLS-scoped `createClient()` preserved).
- Non-comment `.or(` count in route.ts — **0** (no published-bypassing or-filter).
- `tsc --noEmit` — no errors in the browse route files; `eslint` — clean on both touched files.

### Non-vacuity proof (acceptance criterion)

Per Task 2's acceptance criterion, I temporarily changed the projection to emit the raw `r.name` (bypassing `displayStrategyName`). Result: BOTH new cases (`T29-merge` and `T29-merge-control`) FAILED loudly — `expected '{"strategies":[{...,"name":"Renaissance Medallion",...}]}' not to contain 'Renaissance Medallion'` — alongside the existing T12a/b/d. I then reverted; `git diff --quiet src/app/api/strategies/browse/route.ts` confirms route.ts is byte-clean vs the Task-1 commit and all 25 tests pass. The leak/pseudonymity guard is therefore NON-vacuous: it can fail when the contract is violated.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended the existing H-0300a allow-list test to admit `is_example`**
- **Found during:** Task 1
- **Issue:** The route's projection now legitimately emits a 6th response key (`is_example`). The pre-existing `H-0300a` test pinned the response key set to exactly 5 keys (`Object.keys(...).sort() === ALLOWED`), so it failed once the route emitted the new named key.
- **Fix:** Added `is_example` to the `ALLOWED` array in H-0300a. This is a necessary contract update, not a weakening — the forbidden-key fence (asserting `disclosure_tier` / `backtest_returns` / `user_id` never reach the wire, plus the whole-payload sweep in H-0300b) stays fully intact. The plan anticipated this (`<acceptance_criteria>`: "existing T12a-e + H-0300a/b still green"); keeping H-0300a green required the allow-list bump.
- **Files modified:** src/app/api/strategies/browse/route.test.ts
- **Commit:** df10edaf (committed with Task 1, since the route change makes the existing test fail and the tree must stay green within the atomic unit)

## Known Stubs

None. The `is_example` tag is fully wired end-to-end on the server half (SELECT → typed cast → named projection key → exported wire type). Client consumption (the "Example" pill in `StrategyBrowseDrawer`) is Plan 29-03's scope, as designed — this plan is explicitly the UNIFY-03 server half.

## Threat Flags

None. The change introduces no new network endpoint, auth path, file-access pattern, or schema change. It co-fetches one additional boolean column on an EXISTING RLS-scoped, `withPublishedOnly`-gated, `withAllocatorAuth`-protected read and emits it through the existing explicit allow-list. The threat register's `mitigate` dispositions (T-29-05/06/07/08) are all satisfied by tests in this plan.

## Self-Check: PASSED

- FOUND: src/app/api/strategies/browse/route.ts
- FOUND: src/app/api/strategies/browse/route.test.ts
- FOUND commit: df10edaf (feat(29-02) Task 1)
- FOUND commit: d3157f0a (test(29-02) Task 2)
- SUMMARY written to: .planning/phases/29-unified-composer-spine/29-02-SUMMARY.md (per plan; NOT git-committed — commit_docs is false)
