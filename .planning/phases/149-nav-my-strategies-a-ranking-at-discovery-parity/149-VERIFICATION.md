---
phase: 149-nav-my-strategies-a-ranking-at-discovery-parity
verified: 2026-08-05T17:48:32Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Founder proof case on PROD (post-merge UAT, checker W-3 ruling): authed as founder, open /my-strategies"
    expected: "4 ranked+scored rows (Pnn suffixes when population >= 5; Alpha Centauri present via strategy_keys) + 2 placeholder rows (8 active keys, W-4 archived ruling); click one private row -> factsheet 200; anon same URL -> 404"
    why_human: "PROD data; no DB access from CI; explicitly discharged post-merge by design (149-VALIDATION Manual-Only)"
  - test: "Percentile threshold copy on PROD"
    expected: "If published population < 5, the threshold copy renders and Pnn suffixes are absent — both flip together (getOwnRowPercentiles mirrors getPercentiles' < 5 gates). This is HONEST, not broken"
    why_human: "Live published-population count unknown (RESEARCH Open Q3)"
  - test: "WR-02 expected cross-surface Pnn delta: compare one published own row's Pnn on /my-strategies vs its /discovery/[slug] page"
    expected: "Values may DIFFER — /my-strategies scores against the GLOBAL published universe, /discovery against the category population. The on-page label N must match the global count. Delta is a ruled design decision, NOT a scorer bug"
    why_human: "Cross-surface comparison needs live data; UAT must be briefed not to read the delta as a defect"
  - test: "Owner-draft factsheet freshness (Phase 148 Lane A unstable_cache survives deploys)"
    expected: "A FRESH draft id (or revalidateTag per 148's Manual-Only note) resolves through the owner lane without stale-cache interference"
    why_human: "Cache behavior across deploys is only observable on the deployed environment"
---

# Phase 149: NAV — "My strategies": a ranking at discovery parity — Verification Report

**Phase Goal:** The allocator side stops being write-only — a sidebar entry shows every key they uploaded and every strategy derived from them as a ranking at parity with the external/discovery ranking, and every row opens its factsheet
**Verified:** 2026-08-05T17:48:32Z
**Status:** human_needed (all code-level truths VERIFIED; 4 Manual-Only items discharged post-merge by design)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Sidebar "my strategies" (MY WORKSPACE) entry opens a ranking covering every uploaded key AND derived strategies incl. `private`/`draft` | ✓ VERIFIED (code) / proof case → human | `Sidebar.tsx:141-142` — `label: "My Strategies", href: "/my-strategies"` inside `showsAllocatorWorkspace` (:78,:103), under `heading: "MY WORKSPACE"` (:181). `page.tsx:64-66` fetches `getMyStrategies` + `getStrategylessActiveKeys` + portfolio. `queries.ts:299-303` — `.eq("user_id", userId).neq("status","archived")` = every non-archived status incl. private/draft. Placeholder rows per bare active key via `deriveStrategylessKeys` (queries.ts:341-374) covering BOTH `api_key_id` and `strategy_keys` link forms, archived ≠ coverage. Founder 8-key census is the PROD human item. |
| 2 | PARITY with discovery ranking — same columns, sort, `#n`+percentile per DESIGN.md | ✓ VERIFIED | Same `StrategyTable` component; only 3 production mounts exist (`browse/[slug]/page.tsx:63`, `discovery/[slug]/page.tsx:81`, `MyStrategiesSection.tsx:62`). `/browse` props variant (no userId/star column, page.tsx:144-150). Sticky `#{rank}` cell (StrategyTable.tsx:869-871), `pctSuffix` Pnn on active sort column (:970-985). Grid suppressed on owner surface per the approved 2026-08-05 UI-SPEC amendment (`effectiveViewMode` clamp :298 + `showViewToggle={visibility !== "owner-all-statuses"}` :641) — a spec'd delta, not a parity break. |
| 3 | Structural reuse ASSERTED — existing component/query, visibility predicate the only difference, no second implementation | ✓ VERIFIED | `src/__tests__/phase-149-my-strategies-parity.test.ts` — **13/13 green** (12 pins; pin 2 iterated over both public pages). Pin 1: literal default `visibility = "published-only"` (StrategyTable.tsx:272) + parameterized (not deleted) published filter (:443-444). Pin 5: `withPublishedOnly` occurrence COUNT = 2 in `getPercentiles`. Pins 9/11: BOTH callers delegate to the ONE `scoreAgainstPopulation` core (`percentile-core.ts:81`; `queries.ts:173` and `:559,:562`), no second inversion arm. Pin 10: exactly ONE widening consumer. Oracle: `git diff origin/main -- src/lib/queries.percentiles.test.ts` → **empty (0 lines)**. B10 raw-predicate sweep green (`visibility.test.ts:87-143`). |
| 4 | Metrics for private/draft from the SAME analytics as the factsheet; honest pending state, never zeros | ✓ VERIFIED | `shapeRankingRows` (queries.ts:242-259) is the shared shaper for discovery AND `getMyStrategies` — same `strategy_analytics` embed, `analyticsPresent = a !== null` preserved. Chip: `analyticsPresent === false → null` coercion (StrategyTable.tsx:851-854) routed into `deriveEmptySeriesState` 16h bound → "Syncing"/"No data" chips (:948-963), owner-arm only. Placeholder rows: every metric cell a literal em-dash `—` (:1130-1152), no link, "No strategy yet" chip — no invented data. WR-01 FIXED and verified in source: both fetchers return `null` on error (queries.ts:305-309, :429-437), page renders `role="status"` "temporarily unavailable" notice (page.tsx:74, :124-133), `isEmpty` requires fetch success (:115); regression describe in `page.test.tsx:538` (proven RED pre-fix per REVIEW Fix Round 1). |
| 5 | Every row — incl. private/draft — opens its factsheet, never `notFound()` | ✓ VERIFIED (code) / PROD click-through → human | Name cell `<Link href={/factsheet/${s.id}}>` inherited unchanged (UI-SPEC anatomy row; visibility spec asserts private rows render a real `<a href="/factsheet/…">` — M1 asymmetry evidence). `/factsheet/[id]` resolves via Phase 148's owner lane (verified in Phase 148; 148 regression pair 20/20 per 149-VALIDATION gate results). Owner-draft cache freshness is a human item. |

**Score:** 5/5 truths verified at code level

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/my-strategies/page.tsx` | Auth-gated RSC page | ✓ VERIFIED | `noStore()` first statement (:43), `requireRolePage(supabase, user, "allocator")` outside try/catch (:53), comparison-set copy `mapCopy(n)` = "Ranked against N published strategies…" (:29-30, rendered :105,:138-143) |
| `src/app/(dashboard)/my-strategies/MyStrategiesSection.tsx` | Client host mounting StrategyTable | ✓ VERIFIED | `visibility="owner-all-statuses"` (:71), `placeholderKeys` (:72), `onFinishSetup` → ContributionWizardOverlay (:73,:80-87), `percentiles={ownMap}` only (:70, page.tsx:155) |
| `src/app/(dashboard)/my-strategies/MyStrategiesEmptyState.tsx` | Empty-success panel | ✓ VERIFIED | Rendered only when `isEmpty` (fetch-success + zero rows, page.tsx:115,:134-135) |
| `src/lib/queries.ts` — getMyStrategies / getStrategylessActiveKeys / deriveStrategylessKeys / getOwnRowPercentiles | Own-only predicate, anti-join, scorer helper | ✓ VERIFIED | Own-only `.eq("user_id")` + `.neq("status","archived")` (:302-303 — documented ROADMAP deviation, founder ruling 2026-08-05, strictly narrower than `withPublishedOrOwner`, RLS backstop); anti-join covers strategy_keys (:361-363); `getOwnRowPercentiles` population via `withPublishedOnly` (:519-523), identity-dedupe (:550-557), own rows never mutate the population |
| `src/lib/percentile-core.ts` | The ONE scoring core | ✓ VERIFIED | `scoreAgainstPopulation` (:81-123) — count-based rank, LOWER_IS_BETTER inversion (:111-113), max_drawdown magnitude (:63), identity-dedupe self-inclusion (:103-104) |
| `src/components/strategy/StrategyTable.tsx` | Parameterized visibility, grid suppression, published-gated Simulate | ✓ VERIFIED | Default literal (:272), filter param (:443-444), clamp (:298), toggle (:641), `s.status === "published" && <SimulateImpactButton` (:1056-1057), pending chips (:948-963), 13-td placeholder anatomy (:1100-1163) |
| `src/components/ui/Badge.tsx` | `private` status mapping | ✓ VERIFIED | `private: "bg-badge-other/10 text-text-muted"` (:24) + label `"Private"` (:38) |
| `src/components/layout/Sidebar.tsx` | MY WORKSPACE entry | ✓ VERIFIED | Entry inside allocator branch (:103-142); Sidebar.test.tsx:267-273 pins `a[href="/my-strategies"]` for allocator, ambiguity-safe by href |
| `src/lib/routing/route-contract-manifest.ts` | Route registered | ✓ VERIFIED | `route: "/my-strategies", class: "private"` (:208-212); `check-route-contract` OK (57 routes, VALIDATION gate results) |
| `src/__tests__/phase-149-my-strategies-parity.test.ts` | Structural CI gate | ✓ VERIFIED | Exists; 13/13 green this session; anti-vacuity pin 12 present |
| `src/app/(dashboard)/requireRolePage-wiring.test.tsx` | 8th SURFACES pin | ✓ VERIFIED | `my-strategies/page` entry (:139-142); green |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Sidebar entry | /my-strategies | `href="/my-strategies"` in allocator branch | ✓ WIRED | Sidebar.tsx:141-142; test pins the `<a>` + manager negative |
| page.tsx | getMyStrategies/getStrategylessActiveKeys/getOwnRowPercentiles | server fetches, results rendered | ✓ WIRED | page.tsx:63-90; `own.ownMap` → `percentiles` prop; `bareKeys` → `placeholderRows` (:94-98) |
| MyStrategiesSection | StrategyTable owner arm | `visibility="owner-all-statuses"` | ✓ WIRED | Only production widening call site (gate pin 10) |
| getPercentiles AND getOwnRowPercentiles | scoreAgainstPopulation | delegation | ✓ WIRED | queries.ts:173 (`(rows, rows)` byte-behavior preservation, untouched oracle green) and :559/:562; mutation M7 proved both callers red on core flip |
| Row name cell | /factsheet/[id] (148 owner lane) | `<Link>` | ✓ WIRED | Inherited anatomy; private-row link asserted in visibility spec; 148 regression pair 20/20 |
| Public mounts (browse, discovery) | StrategyTable default arm | NO new props | ✓ WIRED (invariant) | 0 hits for `visibility|placeholderKeys|onFinishSetup` on both public pages (grep this session); gate pins 2+10; mutation M2 measured the gate as the SOLE control for a browse-page widening |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| page.tsx | `strategies` | `getMyStrategies` → supabase `strategies` + `strategy_analytics (*)` embed | Yes — real DB query, own-only predicate | ✓ FLOWING |
| page.tsx | `placeholderRows` | `getStrategylessActiveKeys` → 3 owner-scoped reads (api_keys, strategies, strategy_keys) → pure anti-join | Yes | ✓ FLOWING |
| page.tsx | `own.ownMap` / `populationSize` | `getOwnRowPercentiles` → published-universe fetch → core | Yes — single fetch (I-2), no second getPercentiles call (gate pin 6) | ✓ FLOWING |
| StrategyTable chips | `analyticsPresent` / `computation_status` | `shapeRankingRows` — same analytics the factsheet renders | Yes — absent-row signal survives EMPTY_ANALYTICS fallback | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full phase-149 targeted suite | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts "src/app/(dashboard)/my-strategies" src/components/strategy src/lib/percentile-core.test.ts src/lib/queries.my-strategies.test.ts src/lib/visibility.test.ts --no-file-parallelism` | **39 files / 411 tests passed** | ✓ PASS |
| Structural gate alone | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts` | **13/13 passed** | ✓ PASS |
| Sidebar + role-wiring + Badge + percentiles ORACLE | `npx vitest run …Sidebar.test.tsx …requireRolePage-wiring.test.tsx …Badge.test.tsx …queries.percentiles.test.ts` | **4 files / 64 tests passed** | ✓ PASS |
| Typecheck | `npx tsc --noEmit` | clean, exit 0 | ✓ PASS |
| Oracle zero-edit contract | `git diff origin/main -- src/lib/queries.percentiles.test.ts` | empty (0 lines) | ✓ PASS |
| Public-mount invariance | grep `visibility=|placeholderKeys|onFinishSetup` on both public pages | 0 hits; only 3 production `<StrategyTable` mounts | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes declared or conventional for this frontend phase — SKIPPED (not applicable). The phase's runnable verification is the vitest gate + mutation campaign, both executed above / recorded with pasted RED evidence in 149-VALIDATION (M1–M9, all Observed).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| NAV-01 | 149-01…149-05 (all plans) | "My strategies" sidebar ranking at discovery parity incl. private/draft, honest states, factsheet links | ✓ SATISFIED (code) — PROD proof case pending human UAT | All 5 SCs above; sole requirement mapped to Phase 149 in ROADMAP coverage table (no orphans) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX in any of the 19 changed src files | — | Debt-marker gate clean |
| `src/lib/queries.ts` | ~544-549 | Identity-dedupe comment still implies /my-strategies↔/discovery rank equality (the WR-02 doc-block overclaim; residue was routed to TODOS.md but only IN-01/IN-02 got explicit TODOS lines — the VALIDATION Manual-Only WR-02 note, the load-bearing half, IS present) | ℹ️ Info | Prose-only; below the founder's blocking bar (2026-07-29 stopping rule). Non-blocking. |

### Human Verification Required

All four items are Manual-Only by design (149-VALIDATION; checker W-3 ruling: NO in-phase checkpoint — discharged by POST-MERGE PROD UAT). They do not fail the phase.

#### 1. Founder proof case (SC-1d)
**Test:** Authed PROD as founder → /my-strategies.
**Expected:** 4 ranked+scored rows (Alpha Centauri via strategy_keys) + 2 placeholders; private row → factsheet 200; anon same URL → 404.
**Why human:** PROD data; no DB access from CI.

#### 2. Percentile threshold copy (SC-2c)
**Test:** Observe Pnn suffixes vs threshold copy on PROD.
**Expected:** Both flip together at population < 5; threshold copy is honest, not broken.
**Why human:** Live published-population count unknown.

#### 3. WR-02 expected cross-surface Pnn delta
**Test:** Compare one published own row's Pnn on /my-strategies vs /discovery/[slug].
**Expected:** Delta explainable by global-vs-category population; on-page N matches global count. NOT a defect.
**Why human:** Needs live cross-surface data; UAT briefing required.

#### 4. 148 cache freshness for owner-draft factsheets
**Test:** Use a fresh draft id or `revalidateTag` per 148's Manual-Only note.
**Expected:** Owner lane resolves without stale cache.
**Why human:** Deploy-surviving `unstable_cache` behavior only observable deployed.

### Gaps Summary

None. Every code-level must-have is VERIFIED against source (not summaries): the page exists and is auth-gated with `noStore()`; the predicate is the documented own-only deviation (founder-ruled, strictly narrower than the ROADMAP's literal `withPublishedOrOwner` wording — intent satisfied, no override needed since CONTEXT records the ruling); the anti-join covers both link forms with archived-≠-coverage; ONE scoring core serves both percentile callers with the pre-existing oracle byte-untouched; public mounts are provably unchanged (grep + gate pins + measured mutation M2); honest states hold on all three axes (pending chip coercion, em-dash placeholders, WR-01 error-≠-empty fix with RED-proven regression specs); the sidebar entry and route manifest are wired; and the 13-pin structural gate plus 411 targeted tests plus tsc are green in this verification session. The remaining obligations are the four Manual-Only PROD items, which per the W-3 ruling are post-merge UAT — hence `human_needed`, not `gaps_found`.

---

_Verified: 2026-08-05T17:48:32Z_
_Verifier: Claude (gsd-verifier)_
