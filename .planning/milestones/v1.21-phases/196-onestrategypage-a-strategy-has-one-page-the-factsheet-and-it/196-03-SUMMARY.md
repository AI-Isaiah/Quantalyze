---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 03
subsystem: ui
tags: [factsheet, navigation, back-link, open-redirect, closed-set]
status: complete

requires: []
provides:
  - "FACTSHEET_ORIGINS closed map, parseOrigin, backTargetFor, buildFactsheetHref (src/lib/factsheet/origin.ts)"
  - "BackLink client component (src/components/factsheet/BackLink.tsx)"
affects: [196-05, 196-06, 196-07]

actuals:
  tokens: 4600
  tasks: 2
  commits: 2   # task commits only, measured over plan_head_before..plan_head_after; the SUMMARY commit follows
plan_head_before: 49566dbc00a314300b862d8b1d4b44120c4ed3d7
plan_head_after: 9201ef74b5f81fa2fd32d03f665dfda0caa2733f

tech-stack:
  added: []
  patterns:
    - "Closed-set lookup for viewer-supplied navigation values: exact own-property membership, never `in`, hrefs only from the map"
    - "useSyncExternalStore with a fixed server snapshot for client-only environment reads (referrer/history), instead of setState in an effect (the repo lint rule react-hooks/set-state-in-effect rejects the latter)"

key-files:
  created:
    - src/lib/factsheet/origin.ts
    - src/lib/factsheet/origin.test.ts
    - src/components/factsheet/BackLink.tsx
    - src/components/factsheet/BackLink.test.tsx
  modified: []

key-decisions:
  - "A repeated or array `from`/`cat` is no origin (readSingle returns undefined unless exactly one value)"
  - "For a plain record, `from` is read as an own property only, so an inherited key is never a viewer value"
  - "No-origin BackLink keeps a single Link to DEFAULT_AUTHENTICATED_ROUTE in both states; only the label and onClick change, so it works without JS"

requirements-completed: [ROUTE-04]
---

# Phase 196 Plan 03: Factsheet origin contract and BackLink Summary

One closed origin map (`from` plus `cat`) that is the only source of factsheet back-link labels and hrefs, one `buildFactsheetHref` builder, and a client `BackLink` that renders a named link, a same-origin history "Back", or "Go to Discovery".

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Tracer: from=discovery&cat=crypto-sma renders "Back to Discovery" to /discovery/crypto-sma | 1c99c5bf2 |
| 2 | Closed-set hardening, history "Back", never off-site | 9201ef74b |

## Exported signatures (consumed by plans 05, 06, 07)

From `src/lib/factsheet/origin.ts` (no React, no `server-only`, client-importable):

```ts
export const FACTSHEET_ORIGINS: {
  discovery | browse | allocations | "my-strategies" | strategies | recommendations | admin:
    { label: string; href: string | null }   // href null = category-derived
};
export type FactsheetOriginKey = keyof typeof FACTSHEET_ORIGINS;
export type FactsheetCategorySlug = (typeof DISCOVERY_CATEGORIES)[number]["slug"];
export type FactsheetOrigin = { key: FactsheetOriginKey; cat?: FactsheetCategorySlug };
export type BackTarget = { label: string; href: string };
export function parseOrigin(searchParams: Record<string, string | string[] | undefined> | URLSearchParams): FactsheetOrigin | null;
export function backTargetFor(origin: FactsheetOrigin | null): BackTarget | null;
export function buildFactsheetHref(strategyId: string, origin?: FactsheetOrigin | null): string;
```

From `src/components/factsheet/BackLink.tsx`:

```ts
export function BackLink({ target }: { target: BackTarget | null }): JSX.Element  // "use client"
```

Plan 05: the page calls `backTargetFor(parseOrigin(await searchParams))` and passes the result as `target`. Plans 06 and 07: link sites use `buildFactsheetHref(id, { key, cat? })`.

## Verification

- `npx vitest run src/lib/factsheet/origin.test.ts src/components/factsheet/BackLink.test.tsx`: 2 files, 62 tests pass (54 in origin.test.ts, 8 in BackLink.test.tsx; the plan floor was 15).
- `npx tsc --noEmit`: clean.
- `npm run lint`: 0 errors. Two pre-existing warnings in unrelated files (not touched, out of scope).
- Acceptance greps: `history.back` in BackLink.tsx = 1; `window.location.origin` = 1; `DISCOVERY_CATEGORIES` in origin.ts >= 1; `server-only` in origin.ts = 0.
- No route, page or config file touched.

## Neuter / RED / restore evidence

Both gates were shown RED, restored from a `cp -p` backup, and `cmp` exited 0 before the final GREEN run.

1. Closed-set membership (origin.ts): replaced the `hasOwnProperty` check in `isOriginKey` with a truthiness lookup (`Boolean(FACTSHEET_ORIGINS[value])`). RED: 5 failed / 49 passed. Failing arms named: `from="__proto__"`, `from="constructor"`, `from="toString"`, `from="hasOwnProperty"`, and `a cast-through unknown key adds nothing in buildFactsheetHref`. Restored, `cmp` exit 0, GREEN.
2. Same-origin referrer check (BackLink.tsx): dropped `referrerOrigin === window.location.origin &&`. RED: 1 failed / 7 passed, arm `an off-site referrer stays on Go to Discovery and never calls history.back()`. Restored, `cmp` exit 0, GREEN (62/62).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `react-hooks/set-state-in-effect` lint error on the plan's useEffect design**
- **Found during:** Task 2 (`npm run lint`, a Task 2 acceptance criterion)
- **Issue:** The plan says "in a `useEffect` ... switch to a Back label (state)". The repo lint rule rejects setState inside an effect.
- **Fix:** `useSyncExternalStore(subscribeNever, hasSameOriginHistory, serverSnapshot)`. The server render and the hydration pass get `false` ("Go to Discovery"); the client then reads the real referrer/history. Same observable behavior as the plan (server render is always "Go to Discovery", "Back" appears after mount), and the tests assert exactly that, including `renderToString`.
- **Files modified:** src/components/factsheet/BackLink.tsx
- **Commit:** 9201ef74b

**2. [Rule 1 - Bug] TS2322 in `backTargetFor`**
- **Found during:** Task 2 (`npx tsc --noEmit`)
- **Issue:** `FACTSHEET_ORIGINS[key].href` is `string | null` across the union, so the first draft did not type-check.
- **Fix:** Branch on `href !== null` first; category-derived origins (href null) build from the validated slug.
- **Commit:** 9201ef74b

## Notes for the verifier

- Flagged assumption kept as the plan states: a manager-only viewer with no origin gets "Go to Discovery", and `/discovery` is hidden for managers in `Sidebar.tsx`, so the destination may bounce a manager. Not re-decided here.
- Tests print a harmless jsdom `Not implemented: navigation to another Document` line when they click a real anchor (named-target and off-site arms); assertions are unaffected.
- The tracer gate (Task 1) was re-run end to end after Task 2 and stayed green.
- No PROD database access; nothing here needed it.

## Known Stubs

None.

## Threat Flags

None. T-196-06 (open redirect) and T-196-07 (history branch) are mitigated as planned and covered by the arms above.

## Self-Check: PASSED

- FOUND: src/lib/factsheet/origin.ts, origin.test.ts, src/components/factsheet/BackLink.tsx, BackLink.test.tsx
- FOUND commits: 1c99c5bf2, 9201ef74b
