---
phase: 149-nav-my-strategies-a-ranking-at-discovery-parity
plan: 02
subsystem: api
tags: [supabase-query, visibility-predicate, percentile, anti-join, badge, rls, vitest]

# Dependency graph
requires:
  - phase: 148-owner-lane-cache-isolation
    provides: the owner-lane gate that powers row → factsheet links for own unpublished rows
  - phase: 126-factsheet-trust-signals
    provides: readPublicVerificationSignals (the published-gated trust_tier RPC reader)
provides:
  - "getMyStrategies(userId): own rows at every non-archived status, shaped like discovery rows"
  - "getStrategylessActiveKeys(userId) + pure deriveStrategylessKeys: the Delta-5 placeholder census covering BOTH link forms"
  - "src/lib/percentile-core.ts: the ONE pure scoring core (scoreAgainstPopulation)"
  - "getOwnRowPercentiles: single published-universe fetch → { ownMap, publishedMap, populationSize }"
  - "RankedStrategyRow with the analyticsPresent absent-row signal (B-1 contract)"
  - "Badge `private` status mapping"
affects: [149-03 chip coercion, 149-04 my-strategies page, 149-05 phase gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ONE pure scoring core shared by two callers; a second inline formula is a gate failure"
    - "Self-inclusive percentile scoring with IDENTITY dedupe (W-A) — subject value affects only its own score"
    - "Absent-row signal carried alongside a crash-free fallback (analyticsPresent), the returns/route.ts:310-341 coercion precedent"
    - "Own-only `.eq(user_id)` predicate as a strictly-narrower substitute for withPublishedOrOwner"

key-files:
  created:
    - src/lib/percentile-core.ts
    - src/lib/percentile-core.test.ts
    - src/lib/queries.my-strategies.test.ts
    - src/components/ui/Badge.test.tsx
  modified:
    - src/lib/queries.ts
    - src/components/ui/Badge.tsx

key-decisions:
  - "ROADMAP deviation (founder ruling): /my-strategies uses own-only `.eq(\"user_id\", userId)`, NOT withPublishedOrOwner — the named helper is `published OR own` and would render the entire published universe on a page titled My Strategies"
  - "Archived is not coverage and not ranked (W-4): getMyStrategies carries `.neq(\"status\",\"archived\")` and deriveStrategylessKeys treats an archived-only-covered key as bare"
  - "Percentile formula extracted to ONE pure core; getPercentiles delegates via scoreAgainstPopulation(rows, rows) and its oracle stayed green with ZERO edits"
  - "An own row that is ALSO published is handed to the scorer AS the population row it already is, so its /my-strategies rank equals its /discovery rank"
  - "strategy_keys is absent from the generated database.types.ts; ONE narrowed builder cast rather than widening the client — type regeneration deferred"

patterns-established:
  - "shapeRankingRows: the shared row-shaper for every ranked strategy list (discovery, browse, my-strategies)"
  - "deriveStrategylessKeys: pure @internal export with a literal-fixture falsifier, the isPerKeyDailiesEligibleKey precedent"

requirements-completed: [NAV-01]

# Metrics
duration: 21min
completed: 2026-08-05
---

# Phase 149 Plan 02: Server fetchers, percentile core, Badge fix Summary

**Own-only `getMyStrategies` + a two-link-form strategyless-key census, the percentile formula extracted into one pure self-inclusive scoring core shared by discovery and /my-strategies, and the live `private` Badge defect closed with the file's first spec.**

## Performance

- **Duration:** ~21 min
- **Started:** 2026-08-05T14:28:30Z
- **Completed:** 2026-08-05T14:50:00Z
- **Tasks:** 3 (all TDD: RED observed before every GREEN)
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

- `getMyStrategies(userId)` returns the owner's rows at **every non-archived status**, shaped identically to the discovery rows so /my-strategies reaches ranking parity.
- `deriveStrategylessKeys` closes the Delta-5 census defect: coverage considers **both** `strategies.api_key_id` and `strategy_keys`, so the founder's Alpha Centauri composite (3 keys, `api_key_id: null`) no longer fabricates 3 spurious "no strategy yet" placeholders.
- The percentile formula now lives in exactly one place (`src/lib/percentile-core.ts`). `getPercentiles` delegates to it and `queries.percentiles.test.ts` passes **with zero edits** — behaviour preservation proven by an untouched oracle.
- `getOwnRowPercentiles` makes one published-universe fetch and returns `{ ownMap, publishedMap, populationSize }`, so plan 04 needs no second `getPercentiles` call.
- `analyticsPresent` survives the `EMPTY_ANALYTICS` fallback, preserving the absent-vs-pending distinction plan 03's chip coercion depends on.
- Badge `private` renders **"Private"** with muted ink instead of a draft-inked raw lowercase string on two shipping surfaces.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1: getMyStrategies + getStrategylessActiveKeys + pure anti-join**
   - `d74a5ee7` (test — RED spec)
   - `dcd375f8` (feat — implementation)
2. **Task 2: percentile scoring core + getOwnRowPercentiles**
   - `dcbe6faf` (test — RED spec)
   - `6fb01d0e` (feat — extraction + helper)
3. **Task 3: Badge `private` mapping + the file's first test**
   - `8e07863d` (test — RED spec)
   - `2d468680` (fix — map entries)

## Files Created/Modified

- `src/lib/percentile-core.ts` (new) — `PERCENTILE_METRICS`, `PercentileMap`, and `scoreAgainstPopulation`: the ONE scoring core (count-based rank, lower-is-better inversion, `max_drawdown` magnitude, self-inclusive with identity dedupe).
- `src/lib/percentile-core.test.ts` (new, 162 lines) — pure-core falsifiers with hand-computed expectations.
- `src/lib/queries.my-strategies.test.ts` (new, 233 lines) — pure-function anti-join falsifiers, literal fixtures, no supabase mock beyond the module-load stubs.
- `src/components/ui/Badge.test.tsx` (new, 82 lines) — the file's first spec; status-domain coverage plus the fallback contract.
- `src/lib/queries.ts` — `RankedStrategyRow`, `shapeRankingRows`, `getMyStrategies`, `StrategylessKey`, `deriveStrategylessKeys`, `getStrategylessActiveKeys`, `OwnRowPercentiles`, `getOwnRowPercentiles`; `getPercentiles` rewired to the core; `PERCENTILE_ANALYTICS_COLUMNS` hoisted.
- `src/components/ui/Badge.tsx` — `private` added to `statusMap` and `statusLabelMap`.

## Decisions Made

### 1. ROADMAP deviation, recorded verbatim per the plan (binding founder/orchestrator ruling)

> ROADMAP SC-3 and CONTEXT name `withPublishedOrOwner` as the predicate. That helper is
> `published OR own` (`visibility.ts:130-133`) — on a page titled "My Strategies" it would render
> the ENTIRE published universe (research Pitfall 2). The page query uses OWN-ONLY
> `.eq("user_id", user.id)` at every status. RLS sanctions own-row reads (`strategies_read` =
> `status='published' OR user_id = auth.uid()`, migration 20260405061912:28; `analytics_read` is
> its EXISTS-mirror). `.eq("user_id", …)` is strictly NARROWER than the named helper and cannot
> leak. The ROADMAP wording's intent ("own including unpublished") is satisfied; 148's gate still
> powers the row → factsheet links. Lint-clean by construction: `no-owner-or-on-admin-client`
> matches only the raw `.or(...)` shape, `no-raw-published-predicate` only
> `.eq("status","published")`.

Verified: `npm run lint` clean; the deviation prose lives in the `getMyStrategies` doc-block.

### 2. Scorer ruling citation (FOUNDER RULING 2026-08-05, checker B-4; refined by W-A + I-2)

`getPercentiles` keeps its exact signature, both `withPublishedOnly(` branches, its error split and both `< 5` gates. The scoring core is extracted to one pure function scored **self-inclusively per subject with identity dedupe**: `scoreAgainstPopulation(rows, rows)` reproduces the prior map byte-identically, and a draft is told "if published, this would sit at Pnn" literally. Own rows never enter the population other rows are scored against.

Oracle claim, worded as the plan requires: **inversion + magnitude behaviour preserved (oracle) plus formula/self-inclusion parity (core spec).** The untouched `queries.percentiles.test.ts` alone does not pin the formula SHAPE (W-D) — the core spec's P63 self-inclusion pin, the identity-dedupe parity case (member scores 60, a double-adder scores 67) and the `toEqual` mixed-metric record do.

### 3. Archived ruling (W-4)

Pinned with `status` literals on both sides: `getMyStrategies` carries `.neq("status", "archived")`; `deriveStrategylessKeys` filters archived rows out of the coverage set for **both** link forms, each with an otherwise-identical `"private"` control so the test cannot pass by ignoring status.

### 4. Badge blast radius (declared, not silent)

The `private` mapping improves two LIVE surfaces (`(dashboard)/strategies/page.tsx:177`, `StrategyHeader.tsx:24`). The three `contact_requests` consumers are unaffected — `private` is not in that status domain — and the spec pins `pending`/`declined` to prove the shared map was not disturbed.

## Observed RED outputs (recorded per the plan's output spec)

**Task 1** — `npx vitest run src/lib/queries.my-strategies.test.ts`:
```
TypeError: deriveStrategylessKeys is not a function
 Test Files  1 failed (1)
      Tests  9 failed (9)
```

**Task 2** — `npx vitest run src/lib/percentile-core.test.ts`:
```
Failed to resolve import "./percentile-core" from "src/lib/percentile-core.test.ts"
 Test Files  1 failed (1)
      Tests  no tests
```

**Task 3** — `npx vitest run src/components/ui/Badge.test.tsx` (the defect rendered verbatim):
```
Unable to find an element with the text: Private
<span class="… bg-badge-other/10 text-badge-other">
  private
</span>
 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `strategy_keys` is absent from the generated `database.types.ts`**
- **Found during:** Task 1 (`getStrategylessActiveKeys`)
- **Issue:** `supabase.from("strategy_keys")` does not type-check against the generated `Database` type — the relation is missing from `src/lib/database.types.ts` (the file predates migration 20260710120000 and has not been regenerated). `.eq("owner_id", …)` therefore resolved to `never`. Every other `strategy_keys` reader in the codebase filters on `strategy_id` — a column name the checker resolves against some other generated table — which is why none of them hit this; an owner-scoped read cannot dodge it.
- **Fix:** Narrowed ONE builder to the exact `select(...).eq(...)` shape used here via a single documented cast, rather than widening the whole client or hand-editing a generated file. The owner scope stays a literal `.eq("owner_id", userId)` so the plan's `key_links` pattern still matches.
- **Files modified:** `src/lib/queries.ts`
- **Verification:** `npx tsc --noEmit` clean; `npm run lint` clean; the anti-join spec is green.
- **Committed in:** `dcd375f8`

**2. [Rule 1 - Bug prevention] An own row that is ALSO published must be scored as the population row it already is**
- **Found during:** Task 2 (`getOwnRowPercentiles`)
- **Issue:** The plan's literal construction (`ownSubjects` mapped to fresh `{ id, analytics }` records) creates objects that are never reference-equal to the population rows. The core's identity dedupe is REFERENCE equality (W-A, as specified), so a published own row would have had a *copy* of its own value appended to its own denominator — `n+1` — and the founder would see one rank on /my-strategies and a different one on /discovery for the same published strategy.
- **Fix:** `ownSubjects` reuses the population row object when the own row's id is already in the published population (`populationById.get(r.id) ?? { id, analytics }`). This is the W-A intent read literally — "a subject that already IS a population row is never double-added" — and leaves the drafts/private path exactly as specified.
- **Files modified:** `src/lib/queries.ts`
- **Verification:** `queries.percentiles.test.ts` green unedited; the core spec's identity-dedupe parity case pins the underlying semantics.
- **Committed in:** `6fb01d0e`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug-prevention)
**Impact on plan:** Both were required to ship the plan's own stated contracts. No scope creep — no file outside `files_modified` was touched.

## Issues Encountered

None beyond the two deviations above. Sibling-agent boundaries were respected: `StrategyTable.tsx` / `StrategyFilters.tsx` were not read or modified, and `STATE.md` / `ROADMAP.md` were not touched.

## Deferred Items

- **Regenerate `src/lib/database.types.ts`** so `strategy_keys` (migration 20260710120000) is typed and the narrowed builder cast in `getStrategylessActiveKeys` can be deleted. Out of this plan's declared file scope; not user-facing.

## Known Stubs

None — every function returns live data or an honest fail-soft empty/null. No placeholder text, no hardcoded empty collections flowing to UI.

## Threat Flags

None — no new network endpoint, auth path, file access pattern, or trust-boundary schema change beyond the three owner-scoped reads already in the plan's threat register (T-149-04, T-149-05, T-149-06).

## Verification

- `npx vitest run src/lib/queries.my-strategies.test.ts src/lib/percentile-core.test.ts src/lib/queries.percentiles.test.ts src/components/ui/Badge.test.tsx src/__tests__/phase-63-series-space-guards.test.ts src/__tests__/phase-84-asset-class-flow.test.ts src/__tests__/phase-147-series-resolution-guards.test.ts src/__tests__/phase-148-owner-lane-cache-isolation.test.ts --no-file-parallelism` → **8 files, 83 tests passed**
- Full `src/lib/queries*.test.ts` sweep + all `src/components/ui` specs → green
- `npx tsc --noEmit` → clean
- `npm run lint` → 0 errors (1 pre-existing unrelated warning in `EquityChart.tsx`)
- `git diff 3ef9362..HEAD -- src/lib/queries.percentiles.test.ts` → **empty** (the oracle was never edited)
- `grep -v '^\s*\*\|^\s*//' src/lib/queries.ts | grep -c '100 - '` → **0** (the inversion arm lives only in the core)
- `grep -n 'discovery_categories!inner' src/lib/queries.ts` → present only in `getPercentiles` / `getStrategiesByCategory` / `getPopulatedCategorySlugs` / `getStrategyDetail`; absent from all three new fetchers
- `grep -c 'withPublishedOnly(' src/lib/queries.ts` → 11 (both `getPercentiles` branches intact)

## Next Phase Readiness

Ready for plans 03 and 04. Exact contracts now available from `@/lib/queries`:

```ts
export type RankedStrategyRow = StrategyWithAnalytics & { analyticsPresent: boolean };
export type StrategylessKey = { id: string; exchange: SupportedExchange; label: string };
export type OwnRowPercentiles = { ownMap: PercentileMap; publishedMap: PercentileMap; populationSize: number };
export async function getMyStrategies(userId: string): Promise<RankedStrategyRow[]>;
export async function getStrategylessActiveKeys(userId: string): Promise<StrategylessKey[]>;
export function deriveStrategylessKeys(keys, ownStrategies, strategyKeyLinks): StrategylessKey[]; // @internal
export async function getOwnRowPercentiles(ownRows): Promise<OwnRowPercentiles | null>;
```

- Plan 03 coerces on `analyticsPresent === false` (absent row ≠ pending job).
- Plan 04 calls **only** `getOwnRowPercentiles` — one published-universe fetch on /my-strategies (I-2) — and reads `populationSize` for the comparison-set copy; it is byte-equal to the old `Object.keys(await getPercentiles()).length`.
- `userId` MUST come from `auth.getUser()` at the plan-04 call site (T-149-04).
- The founder-account census (8 keys → 4 strategies → 2 bare keys) is pinned in-phase by the pure-function falsifier; PROD confirmation is discharged by post-merge UAT per the W-3 ruling.

## Self-Check: PASSED

All five created files exist on disk; all six task commits (`d74a5ee7`, `dcd375f8`, `dcbe6faf`, `6fb01d0e`, `8e07863d`, `2d468680`) are present in `git log`.

---
*Phase: 149-nav-my-strategies-a-ranking-at-discovery-parity*
*Completed: 2026-08-05*
