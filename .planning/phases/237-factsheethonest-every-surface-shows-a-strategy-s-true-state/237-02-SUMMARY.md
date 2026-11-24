---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 02
subsystem: og-share-card
tags: [cache, og, no-store, CACHE-01, PROOF-01]
requires: []
provides:
  - "figuresRendered and the no-store ladder in the OG route"
  - "route.cache-ttl.test.tsx: the clock-driven HTTP-cache double (plan 05 adds the held-re-run case)"
affects:
  - "src/app/api/og/factsheet/[id]/route.tsx"
key-files:
  created:
    - "src/app/api/og/factsheet/[id]/route.cache-ttl.test.tsx"
  modified:
    - "src/app/api/og/factsheet/[id]/route.tsx"
    - "src/app/api/og/factsheet/[id]/route.test.tsx"
    - "src/app/api/og/factsheet/[id]/route.public-access.test.tsx"
decisions:
  - "A not-found card and a published card rendered without figures are no-store (ruling 1), reusing FAILURE_CACHE_CONTROL; no new constant"
  - "figuresRendered means 'rendered from admitted analytics with two or more series points', so a terminal Withheld card that prints three dashes keeps the long cache (definition pin, flagged for the founder)"
metrics:
  tasks: 2
  completed: 2026-11-23
status: complete
actuals:
  tasks: 2
  commits: 2
plan_head_before: 4002cf06e657e1fea49eee74e1048edb2ccad9af
plan_head_after: c394bffa4
branch: worktree-agent-a2973448a40cd65aa
requirements: [CACHE-01]
---

# Phase 237 Plan 02: OG card cache ladder (CACHE-01) Summary

The OG share card no longer pins a not-found or figure-less card at the CDN: both go out `no-store`, a rendered terminal card keeps the long cache, and a clock-driven HTTP-cache double over the real `GET` proves a strategy published (or computed) after its first unfurl shows its real card on the very next request.

## What changed

- `route.tsx`: `figuresRendered` (default `false`, declared beside the NaN sentinels) turns `true` right after `computeOgHeadline` returns inside the figure branch. One local `notFound` boolean (`data === null && !failed`) covers malformed, unknown and unpublished ids. The header is `failed || notFound || !figuresRendered ? FAILURE_CACHE_CONTROL : LONG_CACHE_CONTROL`. The `LONG_CACHE_CONTROL` docblock and the comment above the header were rewritten (the old "or a genuine not-found" clause was false). `FAILURE_CACHE_CONTROL` stays defined in the route (ruling 3), no new constant.
- `route.cache-ttl.test.tsx` (new): C1 not-found good-after-bad, C2 figure-less good-after-bad, C3 control (long card served from the store at +30 s, refetched past s-maxage), C4 existence oracle (unknown, unpublished, malformed give equal Cache-Control and equal `renderToStaticMarkup`), C5 definition pin (chain-broken Withheld card keeps LONG).
- `route.test.tsx` F2 and `route.public-access.test.tsx` P1, P2, P3 flipped from LONG to no-store (titles and docblocks updated, CACHE-01 cited). F3 and P4 keep LONG; F1, F4, F5, P7 unchanged.

## Verification

- `npx vitest run 'src/app/api/og/factsheet/[id]'`: 7 files, 76 tests passed.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, 0 errors; 4 warnings, all pre-existing in files this plan does not touch (MetricsColumn.tsx, composite-read-path.ts, queries.stale-analytics-detail.test.ts); planning-hygiene, route-contract, admin-manifest and canonical-domain checks OK.
- Acceptance greps: `figuresRendered` count in route.tsx = 3; `const FAILURE_CACHE_CONTROL` count = 1; `toBe(LONG_CACHE)` code-line count: public-access 1 (was 4), route.test 1 (was 2). `Cache-Control` count in route.stale-analytics and route.stored-parity = 0, page-agreement = 0, figure-gate = 2 (both stay green, no edit).

## PROOF-01 (neutered copy, byte backup `cp route.tsx route.tsx.bak`, restore by `cp`, `cmp` exit 0, then GREEN; the .bak was deleted and never committed)

### 1. Not-found term put back on LONG (Task 1; `failed ? FAIL : notFound ? LONG : !figuresRendered ? FAIL : LONG`)

RED, `route.cache-ttl.test.tsx`:

```
     × C1 - not-found good-after-bad: a strategy published after its first request shows its real card on the very next request 419ms
     × C4 - existence oracle: an unknown, an unpublished and a malformed id send the identical header and the identical card (T-237-03) 8ms
AssertionError: the blank card must not be held by any cache: expected true to be false // Object.is equality
AssertionError: expected 'public, max-age=3600, s-maxage=86400,…' to be 'no-store' // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

Restore: `cmp route.tsx route.tsx.bak` printed `cmp=0`. GREEN:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### 2. `let figuresRendered = true;` (Task 1)

RED:

```
     × C2 - figure-less good-after-bad: a published card with no figures is replaced on the very next request once the row computes 11ms
AssertionError: the dash card must not be held by any cache: expected true to be false // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```

Restore: `cmp=0`. GREEN: `Test Files  1 passed (1)  Tests  5 passed (5)`.

### 3. Full pre-fix header `failed ? FAILURE_CACHE_CONTROL : LONG_CACHE_CONTROL` (Task 2, the pins plus the double)

RED, whole OG directory:

```
     × C1 - not-found good-after-bad: a strategy published after its first request shows its real card on the very next request 602ms
     × C2 - figure-less good-after-bad: a published card with no figures is replaced on the very next request once the row computes 16ms
     × C4 - existence oracle: an unknown, an unpublished and a malformed id send the identical header and the identical card (T-237-03) 11ms
     × F2 — CACHE-01: a genuine not-found (no row, no error) is sent no-store and reports nothing 34ms
     × P1 — an UNPUBLISHED id renders the generic card and nothing of the row, sent no-store (D-02, T-170.3-01, CACHE-01) 567ms
     × P2 — an UNKNOWN id renders the same generic card, sent no-store (D-02, CACHE-01) 32ms
     × P3 — a MALFORMED id renders the generic card as a 200, sent no-store (CACHE-01), and never reaches the database or Sentry (Phase 209 SC3, D-10) 3ms
 Test Files  3 failed | 4 passed (7)
      Tests  7 failed | 69 passed (76)
```

Restore: `cmp=0`. GREEN: `Test Files  7 passed (7)  Tests  76 passed (76)`.

Note: in C1 and C2 the user-visible outcome assertion (the second request is not served from the store) runs before the first-request header assertion, so a wrong header fails the outcome by name first, as in the RED above.

## Deviations from Plan

None in scope. One test-design choice: the plan's neuter for the not-found term cannot isolate not-found from "no figures" (a not-found card is also figure-less), so neuter 1 forces LONG for the not-found term only and neuter 3 is the whole pre-fix header. Both are recorded above.

## Flagged for the founder

- Definition pin: `figuresRendered` means "rendered from admitted analytics with two or more series points". A terminal chain-broken Withheld card that prints three dashes keeps `LONG_CACHE_CONTROL` (test C5). If "no figures rendered" should mean "every value dashed", it is one condition (key on whether any of the three values is finite) and one test case.
- ROADMAP SC-3's "next request" is met literally (no-store). It costs one uncached database read per unknown-id unfurl; a malformed id skips the read (Phase 209 D-10).

## Known Stubs

None.

## Threat Flags

None. T-237-03 (existence oracle) is mitigated by the single `notFound` boolean and proven by C4.

## Self-Check: PASSED
