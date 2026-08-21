---
phase: 149-nav-my-strategies-a-ranking-at-discovery-parity
plan: 04
subsystem: ui
tags: [rsc-page, nav, role-gate, route-contract, tdd, vitest]

# Dependency graph
requires:
  - phase: 149-01
    provides: the `visibility` prop + `showViewToggle` clamp the owner recipe passes
  - phase: 149-02
    provides: getMyStrategies · getStrategylessActiveKeys · getOwnRowPercentiles · RankedStrategyRow
  - phase: 149-03
    provides: PlaceholderKeyRow + placeholderKeys/onFinishSetup props, the status marker and the honest pending chip
  - phase: 148-owner-lane-cache-isolation
    provides: the owner-lane factsheet every rendered row links into
provides:
  - "/my-strategies — the allocator's own ranking at discovery parity (RSC page + client section + empty state)"
  - "route-contract entry { route: '/my-strategies', class: 'private' }"
  - "the 8th requireRolePage SURFACES wiring pin"
  - "the Sidebar 'My Strategies' workspace entry (UI-SPEC Delta 1)"
affects: [149-05 phase gate, 150 OWN-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chain-recording supabase double that routes payloads by QUERY SHAPE, not call order — the only way to fixture three same-table reads inside one Promise.all"
    - "ONE published-universe fetch per owner surface, counted by the spec (a second identical fetch is a regression, asserted not observed)"
    - "Comparison-set copy assembled from parts and asserted with toBe, so an extra/absent sentence reddens rather than passing a toContain"

key-files:
  created:
    - src/app/(dashboard)/my-strategies/page.tsx
    - src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx
    - src/app/(dashboard)/my-strategies/MyStrategiesEmptyState.tsx
    - src/app/(dashboard)/my-strategies/page.test.tsx
  modified:
    - src/lib/routing/route-contract-manifest.ts
    - src/app/(dashboard)/requireRolePage-wiring.test.tsx
    - src/components/layout/Sidebar.tsx
    - src/components/layout/Sidebar.test.tsx

key-decisions:
  - "The SC-2d P100 fixture asserts the CLAMPED literal P99: StrategyTable clamps every Pnn suffix to 1..99 as a pre-existing, deliberate discovery-surface rule. A second unclamped P50 case carries the load-bearing proof that the OWN map reached the row."
  - "The `use cache` verification grep counts a COMMENT, not a directive — the enforceable form anchors the quote to line start (see Deviations)."
  - "Empty-state and section each mount their OWN ContributionWizardOverlay (the AllocationsTabs local-useState precedent); the chrome-level host is unreachable from {children}."
  - "Surface parity (iteration-2 checker I-2): the customize-columns / view-prefs affordances absent here match the /browse variant of this surface — deliberate parity with the closest sibling, not an omission."

patterns-established:
  - "Query-shape payload routing in an RSC page spec: `*, strategy_analytics (*)` = own rows · `id, api_key_id, status` = coverage anti-join · `id, strategy_analytics (…)` = the percentile population"

requirements-completed: [NAV-01]

# Metrics
duration: 23 min
completed: 2026-08-05
---

# Phase 149 Plan 04: /my-strategies page, route contract, role wiring, sidebar entry Summary

**The vertical slice closed: an allocator now reaches `/my-strategies` from the sidebar and sees every own row at every non-archived status — each carrying a `Pnn` scored self-inclusively against the published population from ONE fetch — plus a placeholder row per bare key, under a comparison-set line that states the REAL N.**

## Performance

- **Duration:** ~23 min
- **Started:** 2026-08-05T15:23Z
- **Completed:** 2026-08-05T15:46Z
- **Tasks:** 2 (both TDD: RED observed before every GREEN)
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments

- **The founder's ask is reachable end to end.** Sidebar → `/my-strategies` → ranked own rows (private/draft included) + unranked placeholders → `/factsheet/{id}` via Phase 148's owner lane.
- **The comparison-set copy is TRUE, not merely honest.** N is `getOwnRowPercentiles().populationSize` — the published universe the map was actually computed over — and drafts really do carry a `Pnn`, so the sentence "Pnn compares the row against those N published strategies" describes what is on screen.
- **ONE published-universe fetch (I-2), asserted rather than assumed.** The spec counts population-shaped queries; a re-introduced `getPercentiles` call for the N would red the SC-2c case.
- **The predicates are observable.** The chain-recording double records `.eq`/`.neq` pairs, so `user_id = <session id>` and `status != archived` are literal assertions. An identity stub would have made all of them vacuous (148 Pitfall-5).
- **The role gates are pinned twice** — the 8th `SURFACES` wiring entry (the `need` literal) and the Sidebar manager-only negative case (T-110-16).

## Task Commits

1. **Task 1: page subtree + manifest + role-wiring pin (one commit)**
   - `3a9381c0` (RED observed first — see below)
2. **Task 2: Sidebar entry + role-matrix pin**
   - `b49ea63e` (RED observed first — see below)

## Observed RED outputs

**Task 1** — `npx vitest run "src/app/(dashboard)/my-strategies/page.test.tsx" --no-file-parallelism`, written before any implementation file existed:

```
Error: Failed to resolve import "./page" from "src/app/(dashboard)/my-strategies/page.test.tsx". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

**Task 2** — `npx vitest run src/components/layout/Sidebar.test.tsx --no-file-parallelism`, against the pre-push Sidebar:

```
 × renders an <a> to /my-strategies for an allocator, between Decks and Add a Strategy
   AssertionError: expected null not to be null
 Tests  1 failed | 46 passed (47)
```

The other two Sidebar cases (the manager-only role-leak negative and the `<a>`-not-`<button>` pin) are the **invariance half** — green before *and* after, which is what makes them meaningful as leak pins rather than existence checks.

## Files Created/Modified

- `src/app/(dashboard)/my-strategies/page.tsx` **(new)** — `noStore()` → `createClient()` → `auth.getUser()` → `redirect("/login?redirect=/my-strategies")` → `requireRolePage(supabase, user, "allocator")` outside any try/catch; then three parallel owner-scoped fetches (`getMyStrategies` · `getStrategylessActiveKeys` · `getRealPortfolio`) and, sequentially, `getOwnRowPercentiles(strategies)` — the ONE published-universe read. Formats placeholder rows server-side through `EXCHANGE_DISPLAY`, assembles the comparison-set copy from parts, and branches to the empty state when there are zero strategies AND zero bare keys. No `getPercentiles`, no `userId`/`initialWatchedSet`, no `key={…}` remount prop.
- `src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx` **(new)** — `"use client"`; typed `strategies: RankedStrategyRow[]` so `analyticsPresent` is REQUIRED on this path (W-C), passes `visibility="owner-all-statuses"`, `placeholderKeys`, `onFinishSetup`, and `own?.ownMap` (never the published map) into `StrategyTable`; hosts its own `ContributionWizardOverlay` with `router.refresh()` on success.
- `src/app/(dashboard)/my-strategies/MyStrategiesEmptyState.tsx` **(new)** — the UI-SPEC anatomy and copy verbatim (`border border-border bg-surface rounded-lg px-6 py-8`, no icon), CTA `Add a Strategy` opening its OWN overlay; quotes the Sidebar:129-136 comment on why a `Link` into the manager-guarded `/strategies` subtree is forbidden.
- `src/app/(dashboard)/my-strategies/page.test.tsx` **(new, 9 cases)** — the chain-recording double; SC-1b predicates (incl. the archived `neq` and the absent published gate on the own read); both comparison-copy branches asserted with `toBe` against the verbatim literals; the own-scored `Pnn`; the K sentence present/absent; the empty branch (heading + body + BUTTON cta + note ABSENT); the placeholders-only branch (table renders, note is exactly the K sentence, exchange labels arrive server-formatted, zero population fetches); and the `noStore` / `requireRolePage("allocator")` wiring.
- `src/lib/routing/route-contract-manifest.ts` — `{ route: "/my-strategies", class: "private", notes: … }` in alphabetical position (between `/discovery/:slug/:strategyId` and `/onboarding`), in the same commit as the page (lint Rules 1+4).
- `src/app/(dashboard)/requireRolePage-wiring.test.tsx` — the 8th `SURFACES` entry, plus all three "7 surfaces" prose sites updated; `grep -c '7 surfaces'` → 0.
- `src/components/layout/Sidebar.tsx` — one `workspaceItems.push({ label: "My Strategies", href: "/my-strategies", icon: BarChartIcon })` inside `showsAllocatorWorkspace`, directly above the "Add a Strategy" action item, with the branch's phase/threat-class comment convention. `buildPrimaryMobileNav` untouched.
- `src/components/layout/Sidebar.test.tsx` — three href-scoped cases (Pitfall 10: no bare-text selectors).

## Decisions Made

### 1. The SC-2d `P100` fixture asserts `P99` — and gains a second, unclamped case

`StrategyTable`'s `pctSuffix` clamps every rendered percentile to `1..99` ("P0/P100 are edge artifacts that read as nonsense in a rank hint"). That clamp is pre-existing, deliberate, and shared with `/discovery`; the phase's parity contract forbids changing it here. So the plan's hand-computed 100 for the `sharpe 7.5` subject renders as the literal `P99`, and the spec asserts that with the arithmetic and the clamp both spelled out in a comment.

Asserting only a clamped edge value would be a weak wire-proof, so a **second own draft row** (`sharpe 3.5` → effective `[1,2,3,3.5,4,5,6,7]`, 4 of 8 ≤ 3.5 → **P50**) carries the real weight: `P50` is unclamped, hand-computable, and can only come from `ownMap` — `publishedMap` contains neither draft id, so a mis-wire to the published map renders no suffix at all.

### 2. Both wizard mounts are local, and both open FRESH

`ContributionWizardOverlay` has no preselect seam (`{ isOpen, onClose, onSuccess? }`), and the chrome-level `contributeOpen` state inside `DashboardChrome` is unreachable from `{children}`. Each surface therefore mounts its own overlay with local `useState` — the `AllocationsTabs:1010-1018` precedent. "Finish setup →" opens the wizard on its API-key branch rather than pretending a key is already chosen (binding founder ruling; the preselect follow-up is plan 05's TODOS.md item).

### 3. Surface parity note (iteration-2 checker I-2)

The customize-columns / view-prefs affordances absent on this surface match the **/browse variant** of the table — deliberate parity with the closest sibling, not an omission. Same for the star column and watchlist tabs (`userId`/`initialWatchedSet` omitted): starring your own upload is meaningless.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's stated expectation] The SC-2d `P100` literal is unrenderable**

- **Found during:** Task 1, writing the spec.
- **Issue:** The plan requires "the rendered own row shows the literal `P100`". `StrategyTable.tsx`'s `pctSuffix` clamps to `Math.min(99, Math.max(1, …))`, so a raw 100 renders `P99`. Asserting `P100` would have been a permanently-red test; "fixing" the clamp would have changed the `/discovery` presentation, which the phase's parity contract and SC-2 both forbid.
- **Fix:** assert the clamped `P99` for the plan's fixture (arithmetic + clamp documented inline) **and** add an unclamped `P50` case so the wire-proof does not rest on an edge artifact.
- **Files modified:** `src/app/(dashboard)/my-strategies/page.test.tsx`
- **Verification:** both literals green; `recorded.filter(isPopulationShape)` still length 1 in the same case.
- **Committed in:** `3a9381c0`

### Non-code corrections to the plan's own gates

**2. The `'use cache'` verification grep counts a COMMENT, not a directive**

- The plan's verification is `grep -rn "'use cache'\|\"use cache\"" 'src/app/(dashboard)/my-strategies'` → 0. The plan's own action step tells the executor to copy the recommendations `noStore()` comment, whose whole point is naming the directive: *"any future `'use cache'` directive introduced anywhere in this subtree fails loudly"*. `recommendations/page.tsx` carries the identical literal today. The gate and the action are therefore mutually exclusive as literally written.
- **Enforceable form** (a directive is a statement on its own line, never a mid-sentence quote inside `//`):
  `grep -rnE "^[[:space:]]*[\"']use cache[\"']" 'src/app/(dashboard)/my-strategies'` → **no matches (exit 1)**.
- **Action taken:** kept the precedent comment (Rule 11 conformance — every guarded page in this codebase carries it) and recorded the corrected grep here. **Plan 05 should use the line-anchored form.**

---

**Total deviations:** 1 auto-fixed (Rule 1) + 1 plan-gate correction
**Impact on plan:** none to scope. No file outside `files_modified` was touched. `STATE.md` / `ROADMAP.md` were not modified (worktree mode — the orchestrator owns those).

## Issues Encountered

- `node_modules` was absent in the worktree and was symlinked to the main repo's install. **No package manager was run; zero packages installed** (threat register T-149-SC).
- `getRealPortfolio` is `React.cache()`-wrapped; calling it outside a render request context under vitest works and simply does not memoise across the spec's cases. No adapter needed.

## Verification Results

| Check | Result |
|---|---|
| `npx vitest run my-strategies/page.test.tsx Sidebar.test.tsx requireRolePage-wiring.test.tsx --no-file-parallelism` | **64 passed / 64** (3 files) |
| `npx vitest run src/__tests__ src/components/layout --no-file-parallelism` | **1180 passed, 268 skipped** (99 files) — every structural phase gate incl. phase-32 frozen-spine |
| `npx vitest run src/lib/routing src/components/strategy --no-file-parallelism` | **362 passed / 362** (34 files) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (1 pre-existing unrelated warning in `EquityChart.tsx`); `check-route-contract` → **OK — 57 page routes, all declared** |
| `grep -c '7 surfaces' requireRolePage-wiring.test.tsx` | `0` — no prose drift (I-4) |
| `grep -rnE "^[[:space:]]*[\"']use cache[\"']" '(dashboard)/my-strategies'` | no matches — zero cache directives in the subtree |
| `grep -n '/scenarios' src/components/layout/Sidebar.tsx` | 0 hits — the phase-32 banned substring was not introduced |
| commit deletion check (`--diff-filter=D`) on both commits | none |
| `git status --short` after each commit | clean |

## Threat Flags

None. No new network endpoint, no new auth path, no schema change. The four registered mitigations are implemented and asserted:

- **T-149-11** (owner id) — `getMyStrategies(user.id)` with `user` from `auth.getUser()`; the page takes NO params/searchParams, so V5 is vacuous by construction. The chain-recording spec pins `["user_id", <session id>]` and `["status", "archived"]` on the neq arm.
- **T-149-12** (cross-user HTML cache) — `noStore()` is the first statement; zero `'use cache'` directives in the subtree; route class `private` in the manifest.
- **T-149-13** (nav role leak) — the push lives inside `showsAllocatorWorkspace`; the manager-view negative case asserts `a[href="/my-strategies"]` is null.
- **T-149-14** (placeholder key data) — rows built from `getStrategylessActiveKeys(user.id)`, exchange + label only, formatted server-side through `EXCHANGE_DISPLAY`.
- **T-149-15** (percentile map) — exactly ONE published-gated population fetch (asserted, incl. that it carries the published predicate); N is `populationSize` from the PUBLISHED map; own `Pnn`s come from `ownMap`.
- **T-149-SC** — zero packages installed.

## Known Stubs

None. Every branch on this page renders live data or an honest absence. The one deliberately-unwired seam is inherited from plan 03 and re-stated here: `onFinishSetup` opens the wizard **fresh** rather than with the key preselected, because `ContributionWizardOverlay` has no preselect prop. That is a binding founder ruling with a TODOS.md follow-up owned by plan 05 — the button is fully functional.

## Next Phase Readiness

Everything plan 05's structural gate needs is in place:

- `src/app/(dashboard)/my-strategies/page.tsx` is the ONLY production file passing `visibility="owner-all-statuses"` (and the only one passing `placeholderKeys`, via `MyStrategiesSection.tsx`).
- `getPercentiles` is NOT imported anywhere under `src/app/(dashboard)/my-strategies` — the I-2 single-fetch pin is greppable.
- Use the line-anchored `use cache` grep (deviation 2) and the `(`-suffixed `deriveEmptySeriesState(` form (plan 03 deviation 2).
- **Carry to TODOS.md:** the `ContributionWizardOverlay` preselect seam; and regenerating `src/lib/database.types.ts` so plan 02's `strategy_keys` builder cast can be deleted.
- The founder-account PROD census (8 keys → 4 strategies → 2 bare keys) remains discharged by post-merge UAT per the W-3 ruling.

## Self-Check: PASSED

- All four created files exist on disk (`page.tsx`, `MyStrategiesSection.tsx`, `MyStrategiesEmptyState.tsx`, `page.test.tsx`).
- `page.tsx` contains the `must_haves.artifacts.contains` literal `requireRolePage`.
- Both task commits found in `git log`: `3a9381c0`, `b49ea63e`.
- All three `must_haves.key_links` verified in source: `getMyStrategies(user.id)`, `getOwnRowPercentiles(`, and `visibility="owner-all-statuses"` in `MyStrategiesSection.tsx`.

---
*Phase: 149-nav-my-strategies-a-ranking-at-discovery-parity*
*Completed: 2026-08-05*
