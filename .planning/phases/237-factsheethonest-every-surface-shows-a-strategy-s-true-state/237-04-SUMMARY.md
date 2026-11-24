---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 04
subsystem: factsheet-cache
tags: [unstable_cache, factsheet, usd-view, degraded-build, cache-key, degrade-warnings]
requires: []
provides:
  - "price_read_failed throw inside the public unstable_cache callback"
  - "factsheet payload cache key v27"
  - "factsheet.usd-view-read-failed registry entry with action A-RELOAD"
affects:
  - "src/app/factsheet/[id]/v2/page.tsx (plan 10, wave 2, edits the same file)"
  - "src/lib/degrade-warnings.ts and its test (plan 08, wave 2, adds scenario.analytics-updating)"
  - "src/app/factsheet/[id]/v2/FactsheetView.tsx (plan 09, wave 3, edits PerformanceCharts)"
tech-stack:
  added: []
  patterns:
    - "house degraded-build pattern: throw a payload-carrying error out of the unstable_cache callback so nothing is stored, render it uncached in the page catch"
key-files:
  created: []
  modified:
    - "src/app/factsheet/[id]/v2/page.tsx"
    - "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx"
    - "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx"
    - "src/lib/factsheet/fetch-and-build-payload.ts"
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.usd-toggle.test.tsx"
    - "src/lib/degrade-warnings.ts"
    - "src/lib/degrade-warnings.test.tsx"
decisions:
  - "FactsheetDegradedBuildError is generalised with a reason (conventions_read_failed | price_read_failed) instead of adding a sibling class; the page catch is unchanged"
  - "Only price_read_failed throws; no_priced_day is a data fact and stays cached"
  - "The payload key moves v26 to v27 once; OG_CARD_VERSION belongs to plan 05"
metrics:
  tasks: 2
  commits: 2
  files_changed: 8
status: complete
commits: 2
plan_head_before: 4002cf06e657e1fea49eee74e1048edb2ccad9af
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
---

# Phase 237 Plan 04: Failed BTC price read is never cached Summary

A failed BTC price read now throws a payload-carrying `FactsheetDegradedBuildError` out of the public `unstable_cache` callback, so the page renders the view with no USD toggle once, stores nothing, and the next view rebuilds and retries. The USD-unavailable line now says "Reload this page to try again.", which is true, and the registry entry carries A-RELOAD.

Agent branch: `worktree-agent-a97ee769fb08339d9`. Base `4002cf06e657e1fea49eee74e1048edb2ccad9af`.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | f9b95a08e | throw in the cache callback, v27 key, CACHE-03 cases on the keyed store double |
| 2 | 14bb8472b | reload sentence, A-RELOAD registry entry, pins |

## A1 settled for the installed copy (`next@16`, `node_modules/next/dist/server/web/spec-extension/unstable-cache.js`)

A throwing callback stores nothing on a miss. The miss path awaits the callback BEFORE it queues `cacheNewResult`, so a throw propagates past both:

```
216            // If we got this far then we had an invalid cache entry and need to generate a new one
217            const result = await _workunitasyncstorageexternal.workUnitAsyncStorage.run(innerCacheStore, cb, ...args);
218            if (!workStore.isDraftMode) {
...
225                workStore.pendingRevalidates[invocationKey] = cacheNewResult(result, incrementalCache, cacheKey, tags, revalidate, fetchIdx, fetchUrl);
226            }
227            return result;
```

A throwing stale revalidation keeps the last good entry. The revalidation chain only writes inside `.then`, the `.catch` returns the stale value and never calls `cacheNewResult`:

```
182  const revalidationPromise = _workunitasyncstorageexternal.workUnitAsyncStorage.run(innerCacheStore, cb, ...args).then(async (result)=>{
183      await cacheNewResult(result, incrementalCache, cacheKey, tags, revalidate, fetchIdx, fetchUrl);
184      return result;
185  }).catch((err)=>{
186      // @TODO This error handling seems wrong. We swallow the error?
187      console.error(`revalidating cache with key: ${invocationKey}`, err);
188      // Return the stale value on error for foreground revalidation
189      return cachedResponse;
190  });
```

Consequence worth knowing: on a STALE entry whose revalidation hits a price blip, the page serves the stale entry (a previous good build, USD view included) rather than rendering the degraded payload. That is the better outcome and needs no code. The bundled docs under `node_modules/next/dist/docs/` were searched for `unstable_cache`; the source above is the authority used.

## PROOF-01 (RED then GREEN, verbatim)

Byte backups were kept in the scratchpad (outside the repo, never staged) and restored with `cp`, proven with `cmp`.

### 1. Delete the new throw (condition neutered to `if (false && built.payload) {`)

RED:

```
 ❯ 237 CACHE-03 - a failed BTC price read is rendered, never stored (4)
     × GOOD-AFTER-BAD: request 1's failed read has no USD view; request 2 under the same key rebuilds and carries one 48ms
     × IDEMPOTENCY: two failed reads in a row are both rebuilt and nothing is stored; a good read is stored once and then served 18ms
     × PRECISION: the retried view's usdView deep-equals a direct uncached build over the same closes 36ms
AssertionError: the failed read was replayed from the cache instead of rebuilt: expected 1 to be 2 // Object.is equality
AssertionError: a failed read was stored: expected 1 to be 2 // Object.is equality
AssertionError: expected undefined to be defined
 Test Files  1 failed (1)
      Tests  3 failed | 17 passed (20)
```

Restore and GREEN:

```
cmp exit 0
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

### 2. Make the throw fire for no_priced_day too (`usdViewUnavailable !== undefined`)

RED:

```
     × BOUNDARY: a no_priced_day build is a data fact and IS stored; request 2 is served from the store 44ms
AssertionError: a no_priced_day payload was rebuilt instead of served from the store: expected 2 to be 1 // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```

Restore and GREEN:

```
cmp exit 0
 Test Files  4 passed (4)
      Tests  175 passed (175)
```

(The GREEN run is the Task 1 `<automated>` command: the two cache test files, `phase-148-owner-lane-cache-isolation`, `fetch-and-build-payload.test.ts`.)

### 3. Registry: put `shippedAction` back and set `action: null`

RED:

```
     × the two USD-view notes are marker-only: a read failure that ends on A-RELOAD (CACHE-03), and the steady no-priced-day fact 30ms
AssertionError: expected [ 'read_failure', 'none', null, …(2) ] to deeply equal [ 'read_failure', 'none', …(3) ]
-   "A-RELOAD",
-   undefined,
+   null,
+   "It is retried within the hour.",
 Test Files  1 failed (1)
      Tests  1 failed | 79 passed (80)
```

Restore and GREEN:

```
cmp exit 0
 Test Files  1 passed (1)
      Tests  80 passed (80)
```

The three key pins and `EXPECTED_KEY_PREFIX` were red on v26 before the pin edit (`Tests  3 failed | 13 passed (16)` after the page moved to v27), then moved to v27.

## Acceptance measurements

- `grep -a -c "price_read_failed" page.tsx`: HEAD 0, now 8 (>= 1).
- Code-only count of `factsheet-v2-payload-v27` in `page.tsx`: 1. In `page.cache-isolation.test.tsx`: 1.
- Code-only count of `Reload this page to try again.` in `FactsheetView.tsx`: 1.
- Code-only count of `shippedAction` in `degrade-warnings.ts`: HEAD 6, now 5.
- Final targeted run (Task 2 command): 5 files, 162 tests passed (usd-toggle, degrade-warnings, degrade-warning-scan, copy-census, page.usd-trust). Neither the degrade scan nor the copy census needed a pin edit.
- `npm run typecheck`: exit 0. `npm run lint`: exit 0 (4 pre-existing unused-var warnings in `MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`, none in this plan's files).

## Decisions Made

- `FactsheetDegradedBuildError` takes `(payload, reason)`; the message names the reason. Module-private, page catch untouched (it already renders `err.payload` uncached).
- No TTL change. A failed read is stored at no TTL at all.
- The new cases drive the real page and the real builder over the keyed store double. `mockAdmin` now routes `benchmark_prices` to a PostgREST-shaped query that honours filters, order and limit, with its rows and error set per request (`btcFake`). The existing 16 cases stayed green on it unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test shape] The precision case sets aside two page-level decorations**
- **Found during:** Task 1
- **Issue:** the page decorates the cached payload AFTER the cache with `trustTier` and `peerRanks` (`withTrustTier`, `withPeerRanks`), on the USD view too, so a raw `toEqual` against a direct builder call differs on exactly those two fields and nothing else.
- **Fix:** the case compares `usdView` with those two fields neutralised on both sides. Every other field, the figures included, must be identical, which is what "the fix adds no conversion path" requires.
- **Files modified:** `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx`
- **Commit:** f9b95a08e

No other deviations. The two executor-side environment notes: the plan-head ledger file was not written (the base sha is the dispatch sha above), and the shell guard refused compound git commands so each ran as a plain separate call.

## Out of scope, reported per CONTEXT "Research follow-ups"

`readFactsheetBenchmark` failures (called by `buildUsdView` and the native build) stay cached under D-52. CACHE-03 is the USD price read only; that read is unchanged.

## TODOS

`164.6.6.2.1-USDVIEW-READFAIL-CACHED` is closed by this plan. Per the repo rule, the ship that lands it deletes the entry in the same PR and names it in the CHANGELOG. This worktree did not touch `TODOS.md` (not a declared file); the orchestrator or ship step owns that deletion.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or trust-boundary surface. T-237-06 mitigated (throw plus installed-source read plus good-after-bad proof); T-237-07 unchanged (owner lane untouched, `phase-148-owner-lane-cache-isolation` and `page.cache-isolation` green).

## Self-Check: PASSED

- f9b95a08e and 14bb8472b are ancestors of HEAD on `worktree-agent-a97ee769fb08339d9`.
- All eight modified files exist and are committed; no `.bak` file is tracked.
