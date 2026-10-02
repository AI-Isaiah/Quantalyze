---
phase: 13-discovery-v2-polish
plan: 01
subsystem: discovery-watchlist
tags: [discovery, watchlist, allocator, ui, supabase, rls, csrf, rate-limit, e2e, vitest]

requires:
  - migration 024 (user_favorites table + 4 RLS policies)
  - existing src/lib/csrf.ts (assertSameOrigin)
  - existing src/lib/ratelimit.ts (mandateAutoSaveLimiter)
provides:
  - PUT /api/watchlist/[strategyId] — CSRF → auth → rate-limit (30/min) → Zod-shaped action whitelist → idempotent upsert/delete
  - getMyWatchlist(userId) → Set<strategy_id> for SSR hydration
  - StarToggle, WatchlistTabs, EmptyWatchlist components (React 19 useTransition optimistic UI)
  - StrategyTable + StrategyGrid Watchlist extensions (leading column, scope filter, EmptyWatchlist gate, top-right card overlay)
  - /discovery/[slug] page extended to fetch watched-set in parallel and thread to StrategyTable
  - e2e/discovery-watchlist.spec.ts — 1 test, listable + spec_authored=true
  - StrategyTable.test.tsx — 8 cases pinning the Watchlist extension contract
affects:
  - Plan 13-02 (Customize prefs) — extends StrategyFilters' new leadingSlot pattern; reads/writes localStorage keyed by user.id
  - /browse/[slug] (public, unauth) — back-compat verified: StrategyTable renders unchanged when userId is undefined

tech-stack:
  added: []
  patterns:
    - "Server-side idempotency via ON CONFLICT DO NOTHING (upsert + ignoreDuplicates: true) — no client-side debounce"
    - "Optimistic UI with useTransition + single 600ms retry + revert-on-failure (mirrors AllocatorExchangeManager pattern; React 19 useOptimistic not yet adopted in-tree)"
    - "Inline SVG icons (StarOutlineIcon, StarFilledIcon) — no lucide-react / @heroicons / react-icons dependency"
    - "WAI-ARIA tablist with aria-controls=strategy-list — wrapper carries id+role=tabpanel"
    - "leadingSlot? ReactNode prop on StrategyFilters — single-prop extension preserves /browse back-compat"
    - "Card top-right star is a SIBLING of the <Link>, not a child — avoids invalid <button>-inside-<a> markup"
    - "Three-way Promise.all in /discovery/[slug]/page.tsx — strategies + portfolio + watched-set in one round-trip"
    - "@audit-skip pragma at threat-model 'accept' dispositions (T-13-01-05) — matches src/app/api/preferences/route.ts self-action precedent"

key-files:
  created:
    - src/components/strategy/StarToggle.tsx (Task 2)
    - src/components/strategy/StarToggle.test.tsx (Task 1 RED → Task 2 GREEN)
    - src/components/strategy/WatchlistTabs.tsx (Task 2)
    - src/components/strategy/WatchlistTabs.test.tsx (Task 1 RED → Task 2 GREEN)
    - src/components/strategy/EmptyWatchlist.tsx (Task 2)
    - src/components/strategy/StrategyTable.test.tsx (Task 3 — NEW)
    - src/app/api/watchlist/[strategyId]/route.ts (Task 2)
    - src/app/api/watchlist/[strategyId]/route.test.ts (Task 1 RED → Task 2 GREEN)
    - src/lib/queries.test.ts entries for getMyWatchlist (Task 1/2)
    - e2e/discovery-watchlist.spec.ts (Task 1)
    - .planning/phases/13-discovery-v2-polish/13-01-SUMMARY.md (this file)
  modified (Task 3 only):
    - src/components/strategy/StrategyTable.tsx (scope state, watchedSet state, leading star column, EmptyWatchlist gate, id=strategy-list wrapper, WatchlistTabs into leadingSlot, StrategyGrid prop pass-through)
    - src/components/strategy/StrategyFilters.tsx (added leadingSlot? ReactNode prop + render position between All-Filters and Hide-examples per UI-SPEC Layout Contract)
    - src/components/strategy/StrategyGrid.tsx (top-right StarToggle as <Link> sibling, conditional on userId; reserves right-edge title space so badges don't overlap)
    - src/app/(dashboard)/discovery/[slug]/page.tsx (3-way Promise.all with getMyWatchlist; threads userId + initialWatchedSet to StrategyTable)
    - src/app/api/watchlist/[strategyId]/route.ts (added @audit-skip: T-13-01-05 pragmas at the upsert + delete sites — Rule 3 unblock for `npm test` acceptance criterion)

key-decisions:
  - "leadingSlot? ReactNode chosen over a dedicated `<WatchlistTabs>` import inside StrategyFilters — keeps StrategyFilters caller-agnostic so /browse callers (no userId) render unchanged AND so Plan 13-02 can repurpose the same slot pattern if needed"
  - "Star column is conditional on userId, not unconditional — avoids a 12th empty column on /browse where there is no auth and no Watchlist semantics"
  - "EmptyWatchlist gates the entire table/grid/pagination block — not just the table body — because pagination at watchedSet.size===0 would render '0 of 0' which is noise; the empty-state copy points the user back to the All tab"
  - "Card top-right star is rendered OUTSIDE the <Link> wrapper as a sibling positioned absolutely — invalid HTML (<button> inside <a>) was the alternative; the sibling pattern keeps both the card-level click target AND the star independently accessible"
  - "Reserve-w-8-h-2 spacer in card title row when userId is present — without it, long strategy names extending under the absolute-positioned star would visually overlap; aria-hidden=true so SR users don't hear an empty cell"
  - "Test 'Case 7' assertion uses .bg-accent.text-white CSS class selector to find the badge — word-boundary regex \\b1\\b doesn't fire between 't' (word char) and '1' (word char) in 'My Watchlist1' textContent"
  - "Rule 3 deviation: added @audit-skip pragmas in route.ts (Task 2 surface) to unblock the Task 3 acceptance criterion `npm test exits 0`. The pragma is documentation-only — it cites T-13-01-05 (accept disposition) which the threat model already authorized; no behavior change to Task 2's API"
  - "e2e_executed=false; spec_authored=true: did NOT execute Playwright (no live dev server available in this executor); spec is verified listable via `npx playwright test --list -g 'watchlist toggle persists across reload'` (1 test)"

requirements-completed: [DISCO-01]

duration: ~10min (Task 3 only; Tasks 1+2 already shipped at commits 4de6393, 25bb0e0, 7dd132c)
started: 2026-04-28T21:55:50Z
completed: 2026-04-28T22:04:53Z
---

# Phase 13 Plan 01: DISCO-01 Watchlist Summary

**Discovery v2 Watchlist — server-rendered watched-set + leading-column StarToggle + scope-filtering WatchlistTabs + EmptyWatchlist gate, end-to-end from `user_favorites` (migration 024) through optimistic UI to a Playwright contract spec.**

## Performance

- **Duration:** ~10 min for Task 3 (Tasks 1+2 already shipped — see commits 4de6393, 25bb0e0, 7dd132c).
- **Started:** 2026-04-28T21:55:50Z
- **Completed:** 2026-04-28T22:04:53Z

## Task 3 Scope (this commit)

This commit covers ONLY Task 3: wiring the Wave 1 components into StrategyTable + the `/discovery/[slug]` server component, plus the StrategyTable.test.tsx contract pin and the e2e listing verification. Tasks 1 (Wave 0 RED tests) and 2 (Wave 1 GREEN backend + components) shipped previously.

### Files Modified (Task 3 surface)

1. **`src/components/strategy/StrategyTable.tsx`** — added 2 optional props (`userId?: string`, `initialWatchedSet?: Set<string>`); added `scope` + `watchedSet` state; added `onToggleStar` callback (useCallback); inserted scope filter as the FIRST narrowing pass in the `useMemo` filter chain; injected `<WatchlistTabs>` via `leadingSlot` (only when `userId !== undefined`); added a conditional leading `<th>` + `<td>` containing `<StarToggle size="table">`; gated the table/grid/pagination block on `!showEmptyWatchlist`; rendered `<EmptyWatchlist>` when `scope === "watchlist" && watchedSet.size === 0`; threaded `userId/watchedSet/onToggleStar` to `<StrategyGrid>`; updated empty-row colSpan from 11 → 12 when star column is present; added `id="strategy-list" role="tabpanel"` to the table/grid wrapper.

2. **`src/components/strategy/StrategyFilters.tsx`** — added `leadingSlot?: ReactNode` optional prop; renders the slot between the All-Filters button and the Hide-examples checkbox per UI-SPEC Layout Contract (filter row order: search → All Filters → leadingSlot → Hide-examples → Sort → Customize → ViewToggle).

3. **`src/components/strategy/StrategyGrid.tsx`** — added 3 optional props (`userId?`, `watchedSet?`, `onToggleStar?`); restructured each card to wrap the existing `<Link>` in a `relative` container so the new top-right `<StarToggle size="card">` can render as a SIBLING (not a child) of the link — keeps invalid `<button>`-inside-`<a>` markup out of the DOM; reserves `w-8 h-8` right-edge title space when `userId` is present so the absolute-positioned star never overlaps badges/title.

4. **`src/app/(dashboard)/discovery/[slug]/page.tsx`** — widened the 2-way `Promise.all` to 3-way; added `getMyWatchlist(user.id)` to the import list; threads `userId={user.id}` + `initialWatchedSet={watchedSet}` to `<StrategyTable>`.

5. **`src/components/strategy/StrategyTable.test.tsx`** (NEW) — 8 cases pinning the Watchlist extension contract:
   - Case 1: WatchlistTabs renders when userId provided
   - Case 2: WatchlistTabs absent when userId undefined (back-compat)
   - Case 3: Leading star column (3 buttons for 3 rows) when userId provided
   - Case 4: No star column when userId undefined
   - Case 5: scope=watchlist + empty set → EmptyWatchlist replaces table
   - Case 6: scope=watchlist + 2-strategy set → only those 2 render (3rd absent)
   - Case 7: Click star → badge renders "1" inside `.bg-accent.text-white` span
   - Case 8: Back-compat sanity — all 3 strategies render when userId undefined

6. **`src/app/api/watchlist/[strategyId]/route.ts`** (Task 2 surface — Rule 3 deviation) — added 2 lines of `@audit-skip: T-13-01-05` pragma comments at the upsert + delete sites. NO logic change. Unblocks the `npm test` acceptance criterion.

## Threat Model Dispositions (cross-link to 13-01-PLAN `<threat_model>`)

| Threat ID | Component | Disposition | Concrete File:Line |
|-----------|-----------|-------------|--------------------|
| T-13-01-01 (CSRF) | PUT /api/watchlist/[strategyId] | mitigate | `src/app/api/watchlist/[strategyId]/route.ts:40-41` (`assertSameOrigin(req)`) |
| T-13-01-02 (DoS / rapid-toggle) | PUT /api/watchlist/[strategyId] | mitigate | `src/app/api/watchlist/[strategyId]/route.ts:55-62` (`mandateAutoSaveLimiter` 30/min, 429 + Retry-After) |
| T-13-01-03 (IDOR) | user_favorites delete path | mitigate | `src/app/api/watchlist/[strategyId]/route.ts:97-98` (`.eq("user_id", user.id).eq("strategy_id", strategyId)`) + migration 024 RLS |
| T-13-01-04 (Info disclosure) | getMyWatchlist | accept | `src/lib/queries.ts:1703-1719` — `userId` sourced from `supabase.auth.getUser()` server-side, never from client input; RLS enforces `user_id = auth.uid()` on SELECT |
| T-13-01-05 (Repudiation / no audit) | PUT /api/watchlist/[strategyId] | accept | `src/app/api/watchlist/[strategyId]/route.ts:79+95` (`@audit-skip: T-13-01-05` pragmas — mirrors `src/app/api/preferences/route.ts` self-action pattern) |
| T-13-01-06 (Input validation) | PUT /api/watchlist/[strategyId] | mitigate | `src/app/api/watchlist/[strategyId]/route.ts:64-73` (whitelist `body.action ∈ {"add","remove"}`; 400 otherwise) |

## Validation Evidence

### Vitest (full unit suite)

```
Test Files  234 passed | 12 skipped (246)
Tests       2329 passed | 148 skipped (2477)
Duration    24.69s
```

### Wave 1 unit suite (per plan `<verification>`)

```
Test Files  5 passed (5)
Tests       53 passed (53)
Duration    1.22s
```

### StrategyTable.test.tsx (Task 3 new)

```
Test Files  1 passed (1)
Tests       8 passed (8)
Duration    598ms
```

### Build

```
npm run build → exit 0; all routes compile (including ƒ /discovery/[slug] and ƒ /browse/[slug])
```

### Playwright spec list

```
$ npx playwright test --list -g "watchlist toggle persists across reload"
[chromium] › discovery-watchlist.spec.ts:20:7 › DISCO-01 watchlist › watchlist toggle persists across reload
Total: 1 test in 1 file
```

`e2e_executed=false; spec_authored=true` — the spec is listable and authored against the contract; full execution awaits a CI run with a live dev server.

### Acceptance Criteria Checklist (per 13-01-PLAN.md lines 750-765)

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `userId?: string \| initialWatchedSet?: Set<string>` ≥ 2 in StrategyTable.tsx | grep returned **2** ✓ |
| 2 | `<WatchlistTabs \| <StarToggle \| <EmptyWatchlist` ≥ 3 in StrategyTable.tsx | grep returned **5** ✓ |
| 3 | `scope === "watchlist"` ≥ 1 in StrategyTable.tsx | grep returned **4** ✓ |
| 4 | `watchedSet.has \| watchedSet.size` ≥ 2 in StrategyTable.tsx | grep returned **5** ✓ |
| 5 | `id="strategy-list"` ≥ 1 in StrategyTable.tsx | grep returned **2** ✓ |
| 6 | `getMyWatchlist` ≥ 1 in /discovery/[slug]/page.tsx | grep returned **3** ✓ |
| 7 | `userId={user.id} \| initialWatchedSet={watchedSet}` ≥ 2 in /discovery/[slug]/page.tsx | grep returned **2** ✓ |
| 8 | `describe \| it( \| test(` ≥ 7 in StrategyTable.test.tsx | grep returned **10** (8 named cases) ✓ |
| 9 | `npm test -- src/components/strategy/StrategyTable` exits 0 | 8 passed ✓ |
| 10 | `npm run build` exits 0 | exit 0 ✓ |
| 11 | `npm test` (full suite) exits 0 | 2329 passed ✓ |
| 12 | Playwright list shows exactly 1 test | 1 test in 1 file ✓ |
| 13 | Inverted: no `tests/e2e/` path drift in spec | PASS ✓ |
| 14 | `userId? \| watchedSet? \| onToggleStar?` ≥ 2 in StrategyGrid.tsx | grep returned **4** ✓ |
| 15 | `<StarToggle` ≥ 1 in StrategyGrid.tsx | grep returned **2** ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Added `@audit-skip: T-13-01-05` pragmas to `src/app/api/watchlist/[strategyId]/route.ts`**
- **Found during:** running `npm test` (full suite) for acceptance criterion 11.
- **Issue:** `src/__tests__/audit-coverage.test.ts` failed with "Found 2 uninstrumented mutation(s): route.ts:81 (.upsert) + route.ts:96 (.delete)". The threat model dispositions T-13-01-05 as `accept` (allocator self-action, no compliance impact, mirrors `src/app/api/preferences/route.ts` pattern), but the audit-coverage test requires either a `logAuditEvent` call OR a `// @audit-skip:` pragma to be physically present in the source file. The pragma was missing.
- **Pre-existing:** Confirmed via `git stash && npm test` on the prior HEAD (`7dd132c`) — the failure existed before Task 3 began. NOT introduced by Task 3.
- **Why fixed inline:** Acceptance criterion 11 of Task 3 (`npm test (full unit suite) exits 0 (no regression in any other test)`) cannot be satisfied without resolving this. The fix is a 2-line comment annotation that brings the code into alignment with the documented threat-model decision — no API change, no behavior change. Cheaper to add the missing comment than to defer-and-skip a Task 3 acceptance criterion.
- **Files modified:** `src/app/api/watchlist/[strategyId]/route.ts` (2 comment lines added at upsert + delete sites).
- **Commit:** included in this Task 3 commit.

### Test Author-Note (not a deviation)

Test "Case 7" in StrategyTable.test.tsx initially asserted `watchTabAfter.textContent.toMatch(/\b1\b/)` to verify the count badge appeared. This regex did NOT match because `\b` is a transition between word and non-word chars, and both `'t'` (in "Watchlist") and `'1'` (badge digit) are word chars — there is no word boundary between them in the concatenated textContent `"My Watchlist1"`. Switched to a CSS-class selector (`.bg-accent.text-white`) inside the tab element — pins the visual badge contract more tightly and matches the pattern already used in `WatchlistTabs.test.tsx:60`.

## Open Follow-Ups for Plan 13-02

- Plan 13-02 ships the Customize cog (replaces text-button "Customize" with `<SettingsCogButton aria-label="Customize discovery view">`) and the right-edge slide-out drawer. The drawer reads/writes `localStorage` keyed by `discovery_view_preferences:{user.id}:{slug}`.
- Plan 13-02 will need to extend `StrategyTable` to accept additional `defaultView`, `defaultSortKey`, `defaultSortDir`, `hideExamples` props (or hydrate them from a hook). The `leadingSlot` pattern established in this plan is reusable but not strictly required for 13-02.
- Plan 13-02 should NOT need to modify `StrategyFilters` props beyond what 13-01 already extended (`leadingSlot`); the cog swap is internal to the existing Customize button position.
- e2e execution: when 13-02 ships and a CI dev-server harness runs Playwright, this spec (`e2e/discovery-watchlist.spec.ts`) should turn GREEN on first execution.

## Self-Check: PASSED

All claimed files exist:
- `src/components/strategy/StrategyTable.tsx` — modified ✓
- `src/components/strategy/StrategyFilters.tsx` — modified ✓
- `src/components/strategy/StrategyGrid.tsx` — modified ✓
- `src/app/(dashboard)/discovery/[slug]/page.tsx` — modified ✓
- `src/app/api/watchlist/[strategyId]/route.ts` — modified ✓
- `src/components/strategy/StrategyTable.test.tsx` — NEW ✓
- `.planning/phases/13-discovery-v2-polish/13-01-SUMMARY.md` — NEW (this file) ✓
