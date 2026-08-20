---
phase: 149-nav-my-strategies-a-ranking-at-discovery-parity
reviewed: 2026-08-05T19:20:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/__tests__/phase-149-my-strategies-parity.test.ts
  - src/app/(dashboard)/my-strategies/MyStrategiesEmptyState.tsx
  - src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx
  - src/app/(dashboard)/my-strategies/page.test.tsx
  - src/app/(dashboard)/my-strategies/page.tsx
  - src/app/(dashboard)/requireRolePage-wiring.test.tsx
  - src/components/layout/Sidebar.test.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/strategy/StrategyFilters.tsx
  - src/components/strategy/StrategyTable.pending-chip.test.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/StrategyTable.visibility.test.tsx
  - src/components/ui/Badge.test.tsx
  - src/components/ui/Badge.tsx
  - src/lib/percentile-core.test.ts
  - src/lib/percentile-core.ts
  - src/lib/queries.my-strategies.test.ts
  - src/lib/queries.ts
  - src/lib/routing/route-contract-manifest.ts
  - TODOS.md
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 149: Code Review Report

**Reviewed:** 2026-08-05T19:20:00Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found (0 Critical, 2 Warning, 2 Info)

## Summary

Reviewed the full `origin/main...HEAD` src diff on `feat/v1.17-149-nav-my-strategies`
against the five plan summaries and 149-CONTEXT rulings. Verification performed
during review (not taken on faith from the summaries):

- `npx vitest run` on all 11 new/modified spec files + the untouched percentiles
  oracle: **164/164 green** (`--no-file-parallelism`).
- `npx tsc --noEmit` and `npx eslint` on every changed production file: clean.
- `git diff origin/main...HEAD -- src/lib/queries.percentiles.test.ts` → empty
  (the zero-edit oracle really was never edited).
- Grep for `visibility=` / `placeholderKeys` / `onFinishSetup` under
  `src/app/(dashboard)/discovery` and `src/app/browse`: **0 hits**; the only
  three production `<StrategyTable` mounts are the two public pages (no new
  props) and `MyStrategiesSection.tsx`.
- `strategy_keys.owner_id` exists with owner-keyed RLS (migration
  20260710120000), so the narrowed-builder read is real, not speculative.
- `private` is an admitted `strategies.status` value (migration 20260716130000);
  `status` is NOT NULL, so the archived-exclusion `neq` cannot NULL-drop rows.
- `SUPPORTED_EXCHANGES` includes `sfox` and `mt5`, so the founder's two bare
  keys survive the unknown-exchange guard in `getStrategylessActiveKeys`.

**Priority 1 — visibility leak: NOT FOUND.** The default `visibility` literal is
`"published-only"` in the destructuring; the in-component publication filter is
parameterized, not deleted; the owner arm is reached only from the owner-scoped
page whose server query is own-only (`.eq("user_id", user.id)`) — strictly
narrower than the roadmap's named helper, with RLS as backstop. The percentile
population fetch in `getOwnRowPercentiles` goes through `withPublishedOnly`;
own rows are scored per-subject against a fresh `[...populationValues, v]`
array — the population array is never mutated, both maps are per-request locals
(no module-level or `React.cache` state a public page could consume), and only
`ownMap` crosses to the client. `noStore()` is the page's first statement,
the route is manifest-class `private`, and `requireRolePage("allocator")` sits
outside any try/catch. Delta 3/4/5 branches are dead on public surfaces by
data, by `visibility` gate, and by absent props respectively — each mechanism
pinned by an invariance test plus the phase-149 structural gate.

**Priority 2 — percentile correctness: formula verified, population scope
carries a documented caveat (WR-02 below).** `scoreAgainstPopulation` is the
one core; `getPercentiles` delegates via `(rows, rows)` and its untouched
oracle stayed green; the identity-dedupe reuse in `getOwnRowPercentiles`
(`populationById.get(r.id)`) correctly prevents the n+1 double-add for a
published own row. Hand-checked the core against its spec's arithmetic
(self-inclusion 5/8→63, member 3/5→60, magnitude+inversion arms): correct.

**Priority 3 — honest states:** placeholder rows render em-dash metric cells
(EMPTY_ANALYTICS metrics are all null, so an absent-analytics own row can never
be scored — confirmed in utils.ts); the chip gates on `isComputedAnalytics`
with the `analyticsPresent === false → null` coercion routing into the shared
16h bound; archived is excluded from both the ranked list and key coverage,
pinned with status literals on both sides. One error-path dishonesty remains
(WR-01).

**Priority 4/5:** role wiring correct (8th SURFACES pin, sidebar entry inside
`showsAllocatorWorkspace`, mobile drawer carries the full nav); the documented
deviations (own-only predicate, narrowed builder cast, empty star td, grid
suppression, P99 clamp) were verified as described and are not reported as
findings per instruction.

## Critical Issues

None found.

## Warnings

### WR-01: Transient DB failure renders the definitive "No strategies yet." empty state

**File:** `src/lib/queries.ts` (getMyStrategies error arm, ~line 355; getStrategylessActiveKeys error arm, ~line 407) and `src/app/(dashboard)/my-strategies/page.tsx:104-113`
**Issue:** Both owner fetchers fail-soft to `[]` on a Supabase error, and the
page's `isEmpty` branch cannot distinguish "empty account" from "fetch failed."
A transient DB/RLS hiccup therefore renders the page-level
`MyStrategiesEmptyState` — a definitive account-state claim ("No strategies
yet." + Add-a-Strategy CTA) — to an owner who has strategies. When only the
keys read fails, placeholder rows silently vanish and the K sentence
disappears. The in-code rationale ("an empty ranking is honest") holds for an
empty *table*, but the page-level empty panel is a stronger claim than the
discovery precedent this idiom was copied from, and the same file already
demonstrates the honest alternative: `getMyWatchlist` returns `null` on error
and `/discovery/[slug]` renders a "temporarily unavailable" notice
(discovery page lines 33-46, 64-75).
**Blast radius:** transient-only, Sentry-captured, matches the
`getStrategiesByCategory` fail-soft idiom — below the founder's blocking bar.
Should still be fixed: this is the founder's proof-case surface for UAT.
**Fix:** Return `null` (not `[]`) from the error arms and thread a degraded
notice, mirroring the watchlist pattern:
```ts
// queries.ts — error arm
return null; // page renders "temporarily unavailable", never the empty state
```
```tsx
// page.tsx
const fetchFailed = strategies === null || bareKeys === null;
const isEmpty = !fetchFailed && (strategies ?? []).length === 0 && …;
```
Alternatively log to TODOS.md as a follow-up if the fail-soft parity with
discovery is ruled deliberate.

### WR-02: Cross-surface Pnn mismatch — /my-strategies scores against the GLOBAL published universe, /discovery/[slug] against a CATEGORY population

**File:** `src/lib/queries.ts` (getOwnRowPercentiles, ~line 508 — no category arm) vs `src/app/(dashboard)/discovery/[slug]/page.tsx:42` (`getPercentiles(slug)`)
**Issue:** The identity-dedupe fix (plan-02 deviation 2) was justified by "the
founder would see one rank on /my-strategies and a different one on /discovery
for the same published strategy," and the review mandate asks to verify rank
equality for a published own row. Equality holds against the *same* population
— but the two surfaces do not use the same population: discovery/browse pass
`getPercentiles(slug)` (category-scoped via the category inner join), while
`getOwnRowPercentiles` fetches the unscoped published universe. A published own
row will generally show a different Pnn on /my-strategies than on its
/discovery category page whenever the category is a proper subset of the
universe. CONTEXT's premise ("the same population every ranking surface uses")
is factually wrong about the discovery surfaces.
**Why not Critical:** 149-RESEARCH (lines 389-393) ruled the unscoped call
deliberately — own rows span multiple categories or none (`category_id`
nullable), a category-scoped call would pick an arbitrary category — and the
/my-strategies comparison-set copy names its set explicitly ("Ranked against N
published strategies"), so each surface is honest about what it shows. The
formula and dedupe are correct; only the *population* differs, by ruling.
**Fix:** No code change recommended. Record the expected cross-surface Pnn
delta in 149-VALIDATION's Manual-Only Verifications (the founder UAT will see
it on any published row) and correct the equality overclaim in the
`getOwnRowPercentiles` doc-block / plan-02 SUMMARY prose so a future reader
does not "fix" the scoping in either direction without a ruling. Log to
TODOS.md.

## Info

### IN-01: MyStrategiesSection prefs comment overstates — nothing persists on this surface

**File:** `src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx:64-68`
**Issue:** The comment says `categorySlug="my-strategies"` gives the surface
"its own scope so its sort/density choices do not overwrite a real category's
saved prefs." True but vacuous: no `userId` is passed, and
`useDiscoveryPrefs(undefined, slug)` is a persistence no-op
(StrategyTable.tsx:339-341), so sort/density/examples choices on
/my-strategies are never written to localStorage at all and reset on every
reload. That is deliberate /browse-variant parity per plan 04, but the comment
implies namespaced persistence that does not exist.
**Fix:** Reword the comment to state both facts (scope key AND no-userId
persistence no-op), or drop the persistence claim.

### IN-02: getOwnRowPercentiles computes a full publishedMap only to count its keys

**File:** `src/lib/queries.ts` (getOwnRowPercentiles return, ~line 560)
**Issue:** `publishedMap` is returned in the `OwnRowPercentiles` contract but
the only production consumer (`page.tsx`) reads `ownMap` and `populationSize`;
the full O(population²-per-metric) self-scoring pass over the published
universe runs on every /my-strategies render solely to derive
`Object.keys(publishedMap).length`. Correctness is unaffected and the
byte-equality to the old N derivation is the stated reason — but if no
follow-up consumes `publishedMap`, a direct count of scored population rows
would do the same work without the second scoring pass, and the unused map is
the kind of export the fallow sweeps flag later.
**Fix:** Either note the intended future consumer in the doc-block or reduce
`populationSize` to a direct count and drop `publishedMap` from the contract
(the page spec's single-fetch pin stays valid either way). Log-only.

---

## Verdict

**SHIP**

No Critical findings. Both Warnings sit below the founder's blocking bar
(2026-07-29: user-facing break or data-integrity only): WR-01 is a
transient-error-path degradation matching an established codebase idiom with
Sentry coverage, and WR-02 is a ruled design decision whose residue is a
documentation overclaim plus a UAT expectation to record. Recommended: land
WR-01's null-vs-empty distinction and the WR-02 VALIDATION/TODOS notes as
fast-follows; IN-01/IN-02 to TODOS.md.

_Reviewed: 2026-08-05T19:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Fix Round 1

**Fixed at:** 2026-08-05
**Scope:** WR-01 code fix; WR-02/IN-01/IN-02 dispositions recorded below.

### WR-01 — FIXED (commit `3753a860`)

`getMyStrategies` and `getStrategylessActiveKeys` now return `null` (not `[]`)
from their error arms — the `getMyWatchlist` idiom — and
`my-strategies/page.tsx` derives `fetchFailed` from either null: a failed
fetch renders a `role="status"` "My Strategies temporarily unavailable —
your strategies and keys may not appear. Refresh to retry." notice (the
discovery watchlist-banner tokens/copy pattern) instead of the definitive
empty state, rendered above whatever partial data did load. Empty-success
keeps the empty state; error and empty stay distinct in both directions.
Sentry/console capture unchanged. Doc-blocks updated to state the null
contract.

Regression specs added to `page.test.tsx` (WR-01 describe, 3 specs) with the
chain-recording double extended with shape-routed per-read failure switches.
Proven RED against the pre-fix `return []` arms: 2 failed / 1 passed
(the empty-success control correctly stays green either way).

Verification: `npx vitest run src/app/(dashboard)/my-strategies
src/lib/queries.my-strategies.test.ts
src/__tests__/phase-149-my-strategies-parity.test.ts --no-file-parallelism`
→ 34/34 green (3 files); `npx tsc --noEmit` clean; `npx eslint` clean on all
three touched files.

### WR-02 — ACKNOWLEDGED, no code change

Per the finding's own recommendation: the unscoped-population call in
`getOwnRowPercentiles` is a 149-RESEARCH ruling (own rows span multiple
categories or none), and each surface names its comparison set explicitly.
Residue (VALIDATION Manual-Only note for the expected cross-surface Pnn
delta + doc-block overclaim correction) to TODOS.md.

### IN-01 — LOGGED

MyStrategiesSection prefs comment overstates (persistence is a no-userId
no-op). To TODOS.md.

### IN-02 — LOGGED

`publishedMap` computed only to count its keys in `getOwnRowPercentiles`.
To TODOS.md.

_Fixed: 2026-08-05_
_Fixer: Claude (gsd-code-fixer)_
