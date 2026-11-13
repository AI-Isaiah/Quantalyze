---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 05
subsystem: ui
tags: [factsheet, viewer-chrome, cache-isolation, back-link, sign-up, deep-link]
status: complete

requires: ["196-02", "196-03", "196-04"]
provides:
  - "resolveFactsheetViewer, FactsheetViewer (src/lib/factsheet/viewer.ts)"
  - "ViewerBar, VisitorHeader, SignUpLine components"
  - "buttonClassName export from Button.tsx"
  - "beforeFooterSlot render prop on FactsheetBody / FactsheetView"
  - "isNotOwnCapital and the not_own_capital deep-link resolution (closes TODOS 198-ADD-DEEPLINK-UNMARKED-OWN)"
affects: [196-10, 196-12, 196-19, 196-21]

actuals:
  tokens: 16700   # chars/4 over the realized diff (66970 chars)
  tasks: 2        # plus the carry_note work, committed as a third commit
  commits: 3
plan_head_before: aab9f6a1abc16d008aea11e447054698e1767686
plan_head_after: a0f56dabe9ab595992b484df25e56c05a4f1da95

key-files:
  created:
    - src/lib/factsheet/viewer.ts
    - src/lib/factsheet/viewer.test.ts
    - src/components/factsheet/ViewerBar.tsx
    - src/components/factsheet/VisitorHeader.tsx
    - src/app/factsheet/[id]/v2/page.viewer-chrome.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/page.owner-lane.test.tsx
    - src/components/ui/Button.tsx
    - src/app/(dashboard)/allocations/lib/add-allocation.ts
    - src/app/(dashboard)/allocations/lib/add-allocation.test.ts
    - src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx
    - src/app/(dashboard)/allocations/components/AddAllocationFlow.test.tsx

key-decisions:
  - "The owner needs no profile read: isOwner short-circuits resolveFactsheetViewer, which keeps the owner lane at its pinned three request-client reads"
  - "A failed note read omits the card rather than seeding an empty, overwritable one"
  - "The public-lane pending placeholder (payload null, not the owner) keeps no chrome: outside the plan's two named renders"

requirements-completed: [ROUTE-04, ROUTE-02]
---

# Phase 196 Plan 05: Viewer chrome Summary

A signed-in viewer bar (back link plus the next step the role allows), a visitor header and sign-up line for a reader with no session, the owner's Edit strategy, and the viewer's own note card, all built per request after the lane decision and carried as render props, never in the cached payload.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Tracer: viewer bar with back link and Request intro, viewer resolved after the lane decision | ca1d96a23 |
| 2 | Every viewer's chrome: Add to my allocation, Edit strategy, visitor header, sign-up line, note card | f5df289d1 |
| carry | `?add=` deep link applies the picker's own-capital test | a0f56dabe |

## Moved files (including the carry_note files)

| File | Why |
|------|-----|
| `src/app/(dashboard)/allocations/lib/add-allocation.ts` | `isNotOwnCapital` (single source of the picker's test), `resolveDeepLink` takes the own-capital set and returns `not_own_capital` |
| `src/app/(dashboard)/allocations/lib/add-allocation.test.ts` | red-first arms for both |
| `src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx` | not in the plan's file list, needed by the carry_note: passes the set to the resolver, renders the notice, and its own `notOwnCapital` now calls `isNotOwnCapital` |
| `src/app/(dashboard)/allocations/components/AddAllocationFlow.test.tsx` | component arms for the deep link landing on the row's reason |

## Closure for plan 21's TODOS edit

TODOS `[198-ADD-DEEPLINK-UNMARKED-OWN]` is closed by commit a0f56dabe. `/allocations?add=<id>` for an own strategy not marked own capital now lands on step 1 with the notice "<name>: Not marked as your own capital. Mark it on My Strategies first." (the picker row's own reason, the row stays `aria-disabled`), never the amount step. The closed claim: lookup is `isNotOwnCapital`, shared with the picker; a failed own-capital read (set undefined) and an archived own row still prefill, as in the picker. Held is checked before not-own-capital. OQ-5's interim clause (param ignored until Phase 198) no longer applies, 198 having merged.

## Grep gate (HEAD to after)

| Check | HEAD | After |
|---|---|---|
| `resolveFactsheetViewer` in page.tsx | 0 | 3 |
| `auth.getUser()` in page.tsx (comments included) | 4 | 3 (two code calls: the Lane B block and the one published-lane read; the showAum call is gone; two comments reworded so they stay true) |
| `ZERO auth.getUser calls` in owner-lane test | 1 | 0 |
| `/allocations?add=` in ViewerBar.tsx | 0 | 1 |
| `beforeFooterSlot` in FactsheetView.tsx | 0 | 9 |
| `export function buttonClassName` | 0 | 1 |

## Rewritten owner-lane arm (arm 10, "lane order lock")

- Old title: `10. published id rendered WITH an authed session → ZERO auth.getUser calls, ZERO .or filters`
- New title: `10. published id rendered WITH an authed session → the published probe resolves before the first getUser call, getUser is called once, ZERO .or filters, the cache is invoked once with no user id, and the payload carries no viewer`
- Order is measured by an `events` log in the mock client (probe table name vs `getUser`), not by a count alone. The file header and the `givenOwnerDraft` fixture were updated: the owner draft row now carries `user_id: OWNER_UID` (an owner lane is by definition a row the session owns), which is what keeps arm 9's pinned three request-client reads exact, since the owner needs no profile read.
- `page.aum-gate.test.tsx` needed no change: its mock client answers `getUser` from one closure and every AUM arm (allowed, denied, owner, error fails closed, per-request) is green with the single shared read.

## RED evidence (neuter, run, RED naming the arm, restore from `cp -p` backup, `cmp`, GREEN)

1. Lane order (T-196-10). Neuter: an extra `await supabase.auth.getUser()` right after `createClient()` in `page.tsx`. RED: owner-lane arm 10 ("expected 'getUser' to be 'strategies'") and viewer-chrome "the published probe runs before the session is read, which is read once". `cmp` OK, 21 passed.
2. Actions follow role. Neuter: every `viewer.canAllocate` in `ViewerBar.tsx` replaced by `true`. RED: 7 arms (unapproved allocator, manager-only, missing profile row, failed profile read, owner published, owner unpublished, owner pending page). `cmp` OK, 27 passed.
3. Chrome chosen from the session (ROUTE-02, never Sign up with a session). Neuter: the page's `viewer.kind === "signed_in" ? ViewerBar : VisitorHeader` forced to the visitor header. RED: 14 arms, including "an allocator: no Sign up link" and "a manager-only viewer". `cmp` OK.
4. Failed note read omits the card. Neuter: `if (noteError)` made `if (noteError && false)`. RED: "a failed note read omits the card". `cmp` OK, 142 passed in the page suite.
5. Carry note. Red-first: the new arms were written before the code (6 RED: five `isNotOwnCapital` plus "lands on the disabled row's reason"). After the fix, neuter `if (false && isNotOwnCapital(...))` in `resolveDeepLink`: RED on the unit arm and on the component arm "an own strategy not marked own capital lands on the picker with that row's reason". `cmp` OK, 121 passed.

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2/page" src/lib/factsheet/viewer.test.ts src/components/ui`: 25 files, 258 tests passed.
- `npx vitest run "src/app/factsheet/[id]/v2" ...` full dir: 1563 passed, 13 failed in one run under load from seven parallel worktrees, all in `FactsheetBody.basis`, `FactsheetView.usd-toggle`, `window-kpis`, `MetricsColumn.record-length`, `basis-context.window-*`; re-run alone, all 6 files (145 tests) pass. Files this plan does not touch; treated as timeouts under load, not a regression.
- `npx vitest run "src/app/(dashboard)/allocations"`: 182 files, 3181 tests passed.
- `npx tsc --noEmit` exit 0. `npm run lint` exit 0 (2 pre-existing warnings in `MetricsColumn.tsx`/`composite-read-path.ts`) and its trailing checks pass, including `check-route-contract` (52 page routes) and planning hygiene.
- Also green: `phase-148-owner-lane-cache-isolation`, `phase-150-capital-ownership-invariant`, `display-sign-single-source`, `audit-c20`, `phase-147-series-resolution-guards`.

## A1 note

RESEARCH A1 (no session cookie means `auth.getUser()` makes no network call) is confirmed in source, not measured at runtime: `node_modules/@supabase/auth-js/src/GoTrueClient.ts` lines 3264-3265 return `{ data: { user: null }, error: new AuthSessionMissingError() }` before any `_request` when there is no access token. The anonymous arm of the test mocks the client, so no fetch count was taken; a runtime fetch count is unmeasured.

## Exported signatures plans 10 and 12 consume

```ts
// src/lib/factsheet/viewer.ts
export type FactsheetViewer =
  | { kind: "anon" }
  | { kind: "signed_in"; userId: string; isOwner: boolean; canAllocate: boolean };
export function resolveFactsheetViewer(
  supabase: SupabaseClient, user: { id: string } | null, ownerId: string | null | undefined,
): Promise<FactsheetViewer>;

// src/components/factsheet/VisitorHeader.tsx  (server components)
export function VisitorHeader({ showSignUp }: { showSignUp: boolean }): JSX.Element;
export function SignUpLine(): JSX.Element;

// src/components/factsheet/ViewerBar.tsx
export function ViewerBar(p: { backTarget: BackTarget | null;
  viewer: Extract<FactsheetViewer, { kind: "signed_in" }>; strategyId: string }): JSX.Element;

// src/components/ui/Button.tsx
export function buttonClassName(o?: { variant?; size?; className? }): string;

// FactsheetBodyOptions / FactsheetView prop
beforeFooterSlot?: ReactNode;   // rendered immediately before FactsheetFooter
```

Plan 10 (layout work on `FactsheetView.tsx`) should keep the slot immediately before `FactsheetFooter`. Plan 12 (share route) reuses `VisitorHeader` (with `showSignUp` false when a session exists, OQ-3) and `SignUpLine`.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 - Blocking] `searchParams` made optional on the page**
Existing page tests call `FactsheetV2Page({ params })` only; a required prop would break every one of them for no gain. Typed `searchParams?:`; the page does `(await searchParams) ?? {}`.

**2. [Rule 1 - Test fixture] owner-draft fixture gets `user_id`**
See the arm 10 note above; not a behaviour change.

### Scope additions

**3. AddAllocationFlow.tsx and its test** were touched beyond the plan's file list because the carry_note requires the flow to render the new resolution (see the moved-files table).

### Judgement calls to flag

- The role="group" actions container is omitted when a viewer has no actions (manager-only, unapproved), instead of rendering an empty group; the plan's behavior list says "group holding ..." only for viewers with actions.
- The pending placeholder on the public lane (payload null, viewer not the owner) renders no viewer bar or visitor header; the plan names only the published render and the owner pending render. Not changed. A signed-in reader of a published-but-uncomputed strategy therefore has no back link there.
- The anonymous published render now does one `auth.getUser()` (cheap per A1) that the old showAum-gated path skipped when `aum` was null; this is the plan's design.
- `viewer.ts` carries no `server-only` import: it takes the client as an argument and reads nothing server-only itself (`benchmark-read.ts` in the same directory documents the same choice).

## Not measured

- No PROD database access was made.
- Runtime fetch count for the anonymous `getUser` (A1) is unmeasured; source read only.
- The `<main>` landmark, published-only indexing and the e2e axe/reflow rows are plan 19's. The header banner sits inside the route layout's `<main>` until that plan moves the landmark.

## Threat Flags

None beyond the plan's threat model (T-196-10, -11, -13, -14 are covered by the arms above). New surface: a `user_notes` read on the published render, filtered by the server-validated user id under existing RLS.

## Known Stubs

None.

## Self-Check: PASSED

Created files exist (viewer.ts, viewer.test.ts, ViewerBar.tsx, VisitorHeader.tsx, page.viewer-chrome.test.tsx); commits ca1d96a23, f5df289d1, a0f56dabe are ancestors of HEAD.
