---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 06
subsystem: api
tags: [factsheet, pdf, tearsheet, held-rerun, etag, cache, fact-02]
requires:
  - phase: 237-factsheethonest
    provides: analyticsHold, HELD_RERUN_CACHE_CONTROL (plan 01)
provides:
  - both PDF routes decide their door through analyticsHold(analytics).admitted
  - factsheet pdf route held ETag suffix and held cache on 200 and 304
  - tearsheet.pdf held cache on 200
  - T5b, the tear sheet seam case for a held re-run (real builder, real page)
affects: [237-11]
tech-stack:
  added: []
  patterns: ["door applies the same verdict as the page it prints, never admit-all-and-let-the-page-decide"]
key-files:
  created: []
  modified:
    - src/app/api/factsheet/[id]/pdf/route.ts
    - src/app/api/factsheet/[id]/pdf/route.test.ts
    - src/app/api/factsheet/[id]/tearsheet.pdf/route.ts
    - src/app/api/factsheet/[id]/tearsheet.pdf/route.test.ts
    - src/app/factsheet/[id]/tearsheet/page.stale-analytics.test.tsx
key-decisions:
  - "The held ETag is the terminal ETag plus a :held suffix inside the quotes, so a held PDF and a terminal PDF of the same computed_at never share a validator"
  - "getFactsheetDetail is NOT edited (ruling 4): the tear sheet page already null-checks analytics only, T5b proves a held row reaches the real builder through it"
requirements-completed: [FACT-02]
status: complete
commits: 2
plan_head_before: 73d18d712b56f0d60f79e11db00df31cf6f19856
plan_head_after: 86bab6303e3e5958dcdd2318fbcf9c830ff90272
actuals:
  tokens: 7000
  tasks: 2
  commits: 2
---

# Phase 237 Plan 06: Both PDF routes stay published during a re-run Summary

**Both PDF routes now decide through `analyticsHold(analytics).admitted`, so a pending or computing re-run over a stored success prints (with a `:held` ETag and a 60 s cache on the factsheet PDF, a 60 s cache on the tear sheet PDF), while first-ever computes, failed rows, composites during a re-run and unbound derive prestamps still answer 400. T5b proves the tear sheet page already holds.**

Agent branch: `worktree-agent-a2848c90d988fb98f`. Re-based to `73d18d712b56f0d60f79e11db00df31cf6f19856` before any work. `plan_head_after` above is the last code commit; this SUMMARY's own commit sits on top of it.

## Accomplishments

- `pdf/route.ts`: the strategy_analytics embed now selects `computation_status, computed_at, cumulative_return, daily_returns, returns_series, data_quality_flags` (server-side only, the response is a PDF). The literal two-status comparison is gone, replaced by `const hold = analyticsHold(analytics); if (!analytics || !hold.admitted) 400`. The ETag is `"<id>:<computed_at>"` plus `:held` inside the quotes when `hold.updating`. One `cacheControl` value (`HELD_RERUN_CACHE_CONTROL` when held, otherwise the unchanged `public, s-maxage=3600, stale-while-revalidate=86400`) feeds both the 304 and the 200. `Vary: Host`, the pending-marker 409, the advanced-open flow and the error paths are untouched.
- `tearsheet.pdf/route.ts`: same select widening and door. The 200 uses `HELD_RERUN_CACHE_CONTROL` when `hold.updating`, otherwise the unchanged `public, s-maxage=300, stale-while-revalidate=300`. `Vary: Cookie, Authorization, Host` is the same either way. The C-0093 comment block gained the held case.
- `page.stale-analytics.test.tsx`: the FactsheetView mock also records `mounted.lastProps` (T1, T5, T6 keep their `mounted.views` assertions). New T5b (`computing` and `pending`) seeds a row with a 30-day series, a finite headline and `cumulative_method` flags, runs the REAL `getFactsheetDetail`, the REAL builder and the REAL page, and asserts `tearsheet-pending` absent, `mounted.views === 1` and `mounted.lastProps.payload.analyticsUpdating === true`.
- The Updating line itself is proven in two asserted links: T5b (the page mounts FactsheetView with `analyticsUpdating` true) and the existing `FactsheetView.updating-line.test.tsx` (that flag renders one `factsheet-analytics-updating` line). The PDF route tests mock the browser, so they cannot see the page.

## T5b branch taken

**Primary branch.** The real builder reached a payload over this harness with no `buildChain` extension: only the one seeded `computing` row (plus a series and flags) was needed, because an updating row skips the cash-conventions read and the other reads answer null or empty. No table was added to `buildChain`. The stop condition did not trigger: the page's own `getFactsheetDetail` read admits the held row, so the premise that the page already holds is true. `getFactsheetDetail`, `fetch-and-build-payload.ts` and `tearsheet/page.tsx` are unchanged (`git status` shows none of them modified).

## Behaviour change for the ship notes (D-04)

A terminal-success row (`complete` or `complete_with_warnings`) whose live `data_quality_flags` carry the `last_success_snapshot` key with no snapshot bound to its `computed_at` now answers **400 "Analytics not computed" on both `GET /api/factsheet/[id]/pdf` and `GET /api/factsheet/[id]/tearsheet.pdf`**. Before this plan both routes admitted it on status alone. This matches the factsheet's queued state for the same row (pinned on the PDF routes by H8 and T6). A row at rest, a legacy row with no snapshot key, and a row whose live flags carry `cumulative_method` are unchanged. A composite row during a re-run is also refused now, which matches the factsheet (RESEARCH A6); before, such a row was admitted only if it was terminal, so this is not a change for terminal composites.

## Existing tests

No existing case needed rewriting. The old fixtures (`complete` with only `computed_at`, `complete_with_warnings`, `running` with no evidence) pass through `analyticsHold` unchanged. 95 tests green across the four named files; `critical-regressions` and `limiter-ordering` (which name these routes) are 187 green.

## PROOF-01 (RED then GREEN, verbatim)

Backups were byte copies kept outside the repo, restored with `cp`, each proven with `cmp` (exit 0) before the GREEN run. The tests were written first and run against the unchanged routes.

**1. pdf route, pre-change (held row answers 400, select unwidened). RED:**

```
     × H1: a pending row over a stored success is admitted, renders, and carries the held cache and a held ETag suffix 14ms
     × H1: a computing row over a stored success is admitted, renders, and carries the held cache and a held ETag suffix 10ms
     × H2: If-None-Match equal to the held ETag during the re-run answers 304 with the held cache and Vary Host 18ms
     × H3: the TERMINAL ETag of the same computed_at does not 304 while the row is re-running (it renders) 11ms
     × H8: a terminal-success row with an unbound derive prestamp is refused (D-04, a behaviour change) 20ms
     × H10: the select names every evidence column, or the hold is dead code 18ms
      Tests  6 failed | 49 passed (55)
```

**2. pdf route, held ETag suffix dropped in a byte-backed copy. RED by name (H3 terminal ETag during a re-run, H3b held ETag after the run finished, and the suffix assertion in H1):**

```
     × H1: a pending row over a stored success is admitted, renders, and carries the held cache and a held ETag suffix 88ms
     × H1: a computing row over a stored success is admitted, renders, and carries the held cache and a held ETag suffix 35ms
     × H3: the TERMINAL ETag of the same computed_at does not 304 while the row is re-running (it renders) 22ms
     × H3b: the HELD ETag does not 304 once the run finished (the row is terminal again) 49ms
      Tests  4 failed | 51 passed (55)
```

Restored: `cmp` exit 0.

**3. pdf route, s-maxage=3600 sent on the held 304 in a byte-backed copy. RED by name:**

```
     × H2: If-None-Match equal to the held ETag during the re-run answers 304 with the held cache and Vary Host 22ms
      Tests  1 failed | 54 passed (55)
```

Restored: `cmp` exit 0. GREEN: `Test Files  1 passed (1)`, `Tests  55 passed (55)`.

**4. tearsheet.pdf route, pre-change (held row answers 400, select unwidened). RED:**

```
     × T1: a pending row over a stored success is admitted and prints with the held cache, Vary unchanged 14ms
     × T1: a computing row over a stored success is admitted and prints with the held cache, Vary unchanged 20ms
     × T6: a terminal-success row with an unbound derive prestamp is refused (D-04, a behaviour change) 23ms
     × T8: the select names every evidence column, or the hold is dead code 12ms
      Tests  4 failed | 29 passed (33)
```

**5. tearsheet.pdf route, held cache forced to the terminal header in a byte-backed copy. RED by name:**

```
     × T1: a pending row over a stored success is admitted and prints with the held cache, Vary unchanged 25ms
     × T1: a computing row over a stored success is admitted and prints with the held cache, Vary unchanged 12ms
      Tests  2 failed | 31 passed (33)
```

Restored: `cmp` exit 0. GREEN: `Tests  33 passed (33)`.

**6. T5b, resolve stage forced (`analyticsUpdating = false && ...`, line 416 of `fetch-and-build-payload.ts`, byte-backed copy). RED by name:**

```
     × T5b: a `computing` re-run over a stored success mounts the opening view with analyticsUpdating true and does not withhold 42ms
     × T5b: a `pending` re-run over a stored success mounts the opening view with analyticsUpdating true and does not withhold 22ms
AssertionError: expected <main …(2)>…(3)</main> to be null
      Tests  2 failed | 3 passed (5)
```

**7. T5b, the payload's threaded field forced false (`analyticsUpdating: false,`, line 1037, byte-backed copy). RED by name, the finer cut (the page mounts but the flag is lost):**

```
     × T5b: a `computing` re-run over a stored success mounts the opening view with analyticsUpdating true and does not withhold 208ms
     × T5b: a `pending` re-run over a stored success mounts the opening view with analyticsUpdating true and does not withhold 62ms
AssertionError: expected false to be true // Object.is equality
      Tests  2 failed | 3 passed (5)
```

Both restored with `cp`, `cmp` exit 0, and `git status --short` afterwards lists no `fetch-and-build-payload.ts` change (the `git diff --quiet` condition holds). GREEN: `Tests  5 passed (5)`.

**Final targeted run (the plan's automated command):**

```
 Test Files  4 passed (4)
      Tests  95 passed (95)
```

(`tearsheet.pdf/route.test.ts`, `pdf/route.test.ts`, `page.stale-analytics.test.tsx`, `complete-status-scan.test.ts`)

## Pre-push gates

- `npm run typecheck` (`tsc --noEmit`): exit 0.
- Lint chain, run step by step because `npm run lint` writes an eslint cache under the shared `node_modules` symlink: `npx eslint` (no cache) over the five touched files, OK; `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene`, `check-canonical-domain`: all OK, exit 0. The full-tree `eslint src/` was not re-run (only touched files were linted).
- Tracer gate on Task 1: `<verify>` re-run end to end (55 green) before Task 2 expanded.

## Deviations from Plan

None - plan executed exactly as written.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface. T-237-10 is mitigated (held ETag suffix, held 304 and 200 cache, covered by H2, H3, H3b). T-237-11 accepted as planned (limiter, PDF slot and `maxDuration` unchanged).

## Notes for plan 11 (census)

Both PDF routes are `holds` entries (door through `analyticsHold`); `getFactsheetDetail` is census-classified only (null-check of `analytics`, select not widened, ruling 4). No migration, no analytics-service change, no undeclared file touched.

## Self-Check: PASSED

- Files modified exist (the five `files_modified` paths), no others changed.
- Commits `76b58dc8c` (Task 1) and `86bab6303` (Task 2) are ancestors of HEAD.
